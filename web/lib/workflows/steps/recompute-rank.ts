import { WorkflowStepCheckpoint } from "@/lib/contracts";
import { putView } from "@/lib/data/write";
import { putOwnedView } from "@/lib/workflows/owned-write";
import { loadCanonicalModel, loadPackedRepoWindow, writeVersionAndClear, writeVersionChunks } from "../recompute/io";
import { computeCategoryViews, lookups, searchIndex } from "../recompute";
import { allTime, newcomers } from "../recompute/ranks";
import {
  derivePackedYearWindow,
  packedGrowthViews,
  packedOrgRankViewsForPeriod,
  packedRepoRankViewsForPeriod,
  type PackedRepoWindow,
  type PackedWindowKind,
} from "../recompute/packed-window";
import { RECOMPUTE_PHASE_SET, type RecomputePhase, type RefreshCursor } from "@/lib/workflows/runtime/types";

// Rank recompute (cross-bucket gather). #486 split families (month/week/rest) but
// the month hop still built object windows + year + two org windows in one isolate
// and never wrote recomputeRank-month.json (CRON-PRE-PR486-RETEST-001).
// CF hops now: packed typed arrays, one product per isolate, persist the packed
// window so later hops do not re-parse monthly/weekly JSON.
// Vercel / tests still drain every hop in-process.
// See docs/VERCEL-DATA-OPERATIONS.md §4 / §3.3.

export type RecomputeRankStepFields = {
  files: number;
  nextRecomputePhase?: RecomputePhase;
};

export const RECOMPUTE_RANK_FAMILIES = {
  month: ["repos", "monthly"],
  monthOrg: ["repos", "monthly"],
  year: ["repos", "monthly"],
  yearOrg: ["repos", "monthly"],
  week: ["repos", "weekly"],
  weekOrg: ["repos", "weekly"],
  rest: ["repos"],
} as const;

export const NEXT_RECOMPUTE_PHASE: Record<RecomputePhase, RecomputePhase | undefined> = {
  month: "monthOrg",
  monthOrg: "year",
  year: "yearOrg",
  yearOrg: "week",
  week: "weekOrg",
  weekOrg: "rest",
  rest: undefined,
};

export function recomputeStepCheckpointName(cursor: RefreshCursor): string {
  return `recomputeRank-${cursor.recomputePhase ?? "month"}`;
}

export function recomputeStartCheckpointName(cursor: RefreshCursor): string {
  return `${recomputeStepCheckpointName(cursor)}-start`;
}

export function recomputeEnqueuedPath(runId: string): string {
  return `ops/workflows/${runId}/recompute-enqueued.json`;
}

export function hasNextRecomputeWindow(result: { [key: string]: unknown }): boolean {
  return typeof result.nextRecomputePhase === "string" && RECOMPUTE_PHASE_SET.has(result.nextRecomputePhase);
}

export function recomputePhaseOf(cursor: RefreshCursor): RecomputePhase {
  const phase = cursor.recomputePhase;
  if (phase && RECOMPUTE_PHASE_SET.has(phase)) return phase;
  return "month";
}

export async function writeRecomputeEnqueued(runId: string): Promise<void> {
  await putView(recomputeEnqueuedPath(runId), {
    v: 1,
    from: "fold",
    to: "recomputeRank",
    firstPhase: "month",
    runId,
    written_at: new Date().toISOString(),
  });
}

export async function writeRecomputeHopStart(runId: string, fencingToken: number, cursor: RefreshCursor): Promise<void> {
  const step = recomputeStartCheckpointName(cursor);
  const now = new Date().toISOString();
  await putOwnedView(
    { runId, fencingToken },
    `ops/workflows/${runId}/steps/${step}.json`,
    WorkflowStepCheckpoint.parse({
      step,
      status: "running",
      started_at: now,
      finished_at: null,
    }),
  );
}

async function writePackedRepoRanks(
  runId: string,
  owner: { runId: string; fencingToken: number },
  packed: PackedRepoWindow,
  w: "month" | "week" | "year",
  generatedAt: string,
): Promise<number> {
  let files = 0;
  let prevFlow: Map<string, number> | undefined;
  let prevStock: Map<string, number> | undefined;
  for (let periodIndex = 0; periodIndex < packed.periods.length; periodIndex++) {
    const ranked = packedRepoRankViewsForPeriod(packed, periodIndex, w, generatedAt, prevFlow, prevStock);
    files += await writeVersionAndClear(runId, ranked.views, owner);
    prevFlow = ranked.nextFlow;
    prevStock = ranked.nextStock;
  }
  return files;
}

async function writePackedOrgRanks(
  runId: string,
  owner: { runId: string; fencingToken: number },
  packed: PackedRepoWindow,
  w: "month" | "week" | "year",
  generatedAt: string,
): Promise<number> {
  let files = 0;
  const carry = new Float64Array(packed.ids.length);
  let prevFlow: Map<string, number> | undefined;
  let prevStock: Map<string, number> | undefined;
  for (let periodIndex = 0; periodIndex < packed.periods.length; periodIndex++) {
    const ranked = packedOrgRankViewsForPeriod(packed, periodIndex, w, generatedAt, carry, prevFlow, prevStock);
    files += await writeVersionAndClear(runId, ranked.views, owner);
    prevFlow = ranked.nextFlow;
    prevStock = ranked.nextStock;
  }
  return files;
}

async function loadRankWindow(
  runId: string,
  kind: PackedWindowKind,
  owner: { runId: string; fencingToken: number },
): Promise<PackedRepoWindow> {
  const loaded = await loadPackedRepoWindow(runId, kind, { owner, persist: true });
  return loaded.packed;
}

export async function runRecomputeRankStep(
  runId: string,
  fencingToken: number,
  cursor: RefreshCursor = {},
): Promise<RecomputeRankStepFields> {
  const phase = recomputePhaseOf(cursor);
  const generatedAt = new Date().toISOString();
  const owner = { runId, fencingToken };
  await writeRecomputeHopStart(runId, fencingToken, cursor);
  switch (phase) {
    case "month": {
      const packed = await loadRankWindow(runId, "month", owner);
      let files = await writePackedRepoRanks(runId, owner, packed, "month", generatedAt);
      files += await writeVersionAndClear(runId, packedGrowthViews(packed, "month", generatedAt), owner);
      return { files, nextRecomputePhase: NEXT_RECOMPUTE_PHASE.month };
    }
    case "monthOrg": {
      const packed = await loadRankWindow(runId, "month", owner);
      const files = await writePackedOrgRanks(runId, owner, packed, "month", generatedAt);
      return { files, nextRecomputePhase: NEXT_RECOMPUTE_PHASE.monthOrg };
    }
    case "year": {
      const month = await loadRankWindow(runId, "month", owner);
      const year = derivePackedYearWindow(month);
      let files = await writePackedRepoRanks(runId, owner, year, "year", generatedAt);
      files += await writeVersionAndClear(runId, packedGrowthViews(year, "year", generatedAt), owner);
      return { files, nextRecomputePhase: NEXT_RECOMPUTE_PHASE.year };
    }
    case "yearOrg": {
      const month = await loadRankWindow(runId, "month", owner);
      const year = derivePackedYearWindow(month);
      const files = await writePackedOrgRanks(runId, owner, year, "year", generatedAt);
      return { files, nextRecomputePhase: NEXT_RECOMPUTE_PHASE.yearOrg };
    }
    case "week": {
      const packed = await loadRankWindow(runId, "week", owner);
      const files = await writePackedRepoRanks(runId, owner, packed, "week", generatedAt);
      return { files, nextRecomputePhase: NEXT_RECOMPUTE_PHASE.week };
    }
    case "weekOrg": {
      const packed = await loadRankWindow(runId, "week", owner);
      const files = await writePackedOrgRanks(runId, owner, packed, "week", generatedAt);
      return { files, nextRecomputePhase: NEXT_RECOMPUTE_PHASE.weekOrg };
    }
    case "rest": {
      const { model } = await loadCanonicalModel(runId, { families: RECOMPUTE_RANK_FAMILIES.rest });
      const views = new Map<string, unknown>(allTime(model, generatedAt));
      for (const [path, view] of newcomers(model, "month", generatedAt)) views.set(path, view);
      for (const [path, view] of newcomers(model, "year", generatedAt)) views.set(path, view);
      for (const [path, view] of lookups(model)) views.set(path, view);
      for (const [path, view] of searchIndex(model, generatedAt)) views.set(path, view);
      let files = await writeVersionAndClear(runId, views, owner);
      files += await writeVersionChunks(runId, computeCategoryViews(model, generatedAt).entries(), owner);
      return { files };
    }
    default: {
      const _exhaustive: never = phase;
      throw new Error(`unhandled recompute phase: ${String(_exhaustive)}`);
    }
  }
}

export async function recomputeRank(runId: string, fencingToken: number): Promise<{ files: number }> {
  let cursor: RefreshCursor = {};
  let files = 0;
  for (;;) {
    const step = await runRecomputeRankStep(runId, fencingToken, cursor);
    files += step.files;
    if (!hasNextRecomputeWindow(step)) return { files };
    cursor = { recomputePhase: step.nextRecomputePhase };
  }
}
