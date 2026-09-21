import { WorkflowStepCheckpoint } from "@/lib/contracts";
import { putView } from "@/lib/data/write";
import { putOwnedView } from "@/lib/workflows/owned-write";
import {
  ensurePackedWindowPersisted,
  loadCanonicalModel,
  loadPackedRepoWindow,
  orgStockToMap,
  pairsToRankMap,
  readPackedWindowMeta,
  readRankCarry,
  streamPackedOrgPeriodRows,
  streamPackedRepoPeriodRows,
  writeRankCarry,
  writeVersionAndClear,
  writeVersionChunks,
} from "../recompute/io";
import { computeCategoryViews, lookups, searchIndex } from "../recompute";
import { allTime, newcomers } from "../recompute/ranks";
import {
  derivePackedYearWindow,
  orgRankViewsFromPeriodRows,
  packedGrowthViews,
  packedOrgRankViewsForPeriod,
  packedRepoRankViewsForPeriod,
  repoRankViewsFromPeriodRows,
  type PackedRepoWindow,
  type PackedWindowKind,
} from "../recompute/packed-window";
import { RECOMPUTE_PHASE_SET, type RecomputePhase, type RefreshCursor } from "@/lib/workflows/runtime/types";

// Rank recompute (cross-bucket gather). #486 split families (month/week/rest) but
// the month hop still built object windows + year + two org windows in one isolate
// and never wrote recomputeRank-month.json (CRON-PRE-PR486-RETEST-001).
// #497 packed hops + persist; month/year fit, but week-start assembled every
// week-win shard (or finalized ~4× month cells) and OOM'd (CRON-PRE-PR497-RETEST-001).
// Week is now: pack hop (one bucket persist, flat v2) → period-window stream hops.
// Vercel / tests still drain every hop in-process.
// See docs/VERCEL-DATA-OPERATIONS.md §4 / §3.3.

export type RecomputeRankStepFields = {
  files: number;
  nextRecomputePhase?: RecomputePhase;
  nextRecomputeOffset?: number;
};

/** Week/weekOrg rank this many persisted periods per isolate. Pack is its own hop. */
export const WEEK_RANK_PERIODS_PER_HOP = 8;

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
  const phase = cursor.recomputePhase ?? "month";
  if (phase === "week" && cursor.recomputeOffset === undefined) return "recomputeRank-week-pack";
  if ((phase === "week" || phase === "weekOrg") && typeof cursor.recomputeOffset === "number") {
    return `recomputeRank-${phase}-${cursor.recomputeOffset}`;
  }
  return `recomputeRank-${phase}`;
}

export function recomputeStartCheckpointName(cursor: RefreshCursor): string {
  const phase = recomputePhaseOf(cursor);
  if (phase === "week" && cursor.recomputeOffset === undefined) return "recomputeRank-week-start";
  return `${recomputeStepCheckpointName(cursor)}-start`;
}

export function extraRecomputeCheckpointSteps(
  cursor: RefreshCursor,
  result: { [key: string]: unknown },
): string[] {
  const current = recomputePhaseOf(cursor);
  const extra: string[] = [];
  if (current === "week" && result.nextRecomputePhase === "weekOrg") extra.push("recomputeRank-week");
  if (current === "weekOrg" && result.nextRecomputePhase === "rest") extra.push("recomputeRank-weekOrg");
  if (!hasNextRecomputeWindow(result)) extra.push("recomputeRank");
  return extra;
}

export function recomputeEnqueuedPath(runId: string): string {
  return `ops/workflows/${runId}/recompute-enqueued.json`;
}

export function hasNextRecomputeWindow(result: { [key: string]: unknown }): boolean {
  if (typeof result.nextRecomputeOffset === "number") return true;
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

async function rankStreamedWeekRepos(
  runId: string,
  owner: { runId: string; fencingToken: number },
  offset: number,
  generatedAt: string,
): Promise<RecomputeRankStepFields> {
  const meta = await readPackedWindowMeta(runId, "week");
  if (!meta) throw new Error(`ops/workflows/${runId}/recompute/week-win/meta.json: missing persist`);
  if (offset >= meta.periods.length) return { files: 0, nextRecomputePhase: "weekOrg", nextRecomputeOffset: 0 };
  const to = Math.min(offset + WEEK_RANK_PERIODS_PER_HOP, meta.periods.length);
  const rows = await streamPackedRepoPeriodRows(runId, "week", offset, to, owner);
  const carry = await readRankCarry(runId, "week", "repo");
  let prevFlow = pairsToRankMap(carry?.flow);
  let prevStock = pairsToRankMap(carry?.stock);
  let files = 0;
  for (let i = 0; i < rows.length; i++) {
    const ranked = repoRankViewsFromPeriodRows(meta.periods[offset + i]!, rows[i]!, "week", generatedAt, prevFlow, prevStock);
    files += await writeVersionAndClear(runId, ranked.views, owner);
    prevFlow = ranked.nextFlow;
    prevStock = ranked.nextStock;
    rows[i] = [];
  }
  if (to < meta.periods.length) {
    await writeRankCarry(owner, {
      v: 1,
      kind: "week",
      dim: "repo",
      nextPeriod: to,
      flow: prevFlow ? [...prevFlow] : [],
      stock: prevStock ? [...prevStock] : [],
    });
    return { files, nextRecomputePhase: "week", nextRecomputeOffset: to };
  }
  return { files, nextRecomputePhase: "weekOrg", nextRecomputeOffset: 0 };
}

async function rankStreamedWeekOrgs(
  runId: string,
  owner: { runId: string; fencingToken: number },
  offset: number,
  generatedAt: string,
): Promise<RecomputeRankStepFields> {
  const meta = await readPackedWindowMeta(runId, "week");
  if (!meta) throw new Error(`ops/workflows/${runId}/recompute/week-win/meta.json: missing persist`);
  if (offset >= meta.periods.length) return { files: 0, nextRecomputePhase: "rest" };
  const to = Math.min(offset + WEEK_RANK_PERIODS_PER_HOP, meta.periods.length);
  const carryFile = await readRankCarry(runId, "week", "org");
  const orgStock = orgStockToMap(carryFile?.orgStock);
  const rows = await streamPackedOrgPeriodRows(runId, "week", offset, to, orgStock, owner);
  let prevFlow = pairsToRankMap(carryFile?.flow);
  let prevStock = pairsToRankMap(carryFile?.stock);
  let files = 0;
  for (let i = 0; i < rows.length; i++) {
    const ranked = orgRankViewsFromPeriodRows(meta.periods[offset + i]!, rows[i]!, "week", generatedAt, prevFlow, prevStock);
    files += await writeVersionAndClear(runId, ranked.views, owner);
    prevFlow = ranked.nextFlow;
    prevStock = ranked.nextStock;
    rows[i] = [];
  }
  if (to < meta.periods.length) {
    await writeRankCarry(owner, {
      v: 1,
      kind: "week",
      dim: "org",
      nextPeriod: to,
      flow: prevFlow ? [...prevFlow] : [],
      stock: prevStock ? [...prevStock] : [],
      orgStock: [...orgStock],
    });
    return { files, nextRecomputePhase: "weekOrg", nextRecomputeOffset: to };
  }
  return { files, nextRecomputePhase: "rest" };
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
      if (cursor.recomputeOffset === undefined) {
        await ensurePackedWindowPersisted(runId, "week", owner);
        return { files: 0, nextRecomputePhase: "week", nextRecomputeOffset: 0 };
      }
      return rankStreamedWeekRepos(runId, owner, cursor.recomputeOffset, generatedAt);
    }
    case "weekOrg": {
      return rankStreamedWeekOrgs(runId, owner, cursor.recomputeOffset ?? 0, generatedAt);
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
    cursor = {
      recomputePhase: step.nextRecomputePhase ?? cursor.recomputePhase,
      recomputeOffset: step.nextRecomputeOffset,
    };
  }
}
