import { WorkflowStepCheckpoint } from "@/lib/contracts";
import { putView } from "@/lib/data/write";
import { putOwnedView } from "@/lib/workflows/owned-write";
import {
  ensurePackedWindowPersisted,
  orgStockToMap,
  pairsToRankMap,
  readPackedWindowMeta,
  readRankCarry,
  streamPackedOrgPeriodRows,
  streamPackedRepoPeriodRows,
  writeRankCarry,
  writeStreamedGrowthViews,
  writeVersionAndClear,
} from "../recompute/io";
import {
  orgRankViewsFromPeriodRows,
  repoRankViewsFromPeriodRows,
  type PackedWindowKind,
} from "../recompute/packed-window";
import { RECOMPUTE_PHASE_SET, type RecomputePhase, type RefreshCursor } from "@/lib/workflows/runtime/types";
import { runRestRankHop } from "./recompute-rest";

// Rank recompute (cross-bucket gather). #486 split families. #497 packed the
// window but week-start still finalized every week cell and OOM'd. Week, and
// now month / year / rest, keep one hop's resident set to a bucket or an
// 8-period slice: pack persists flat v2 per repo bucket, rank streams that
// persist, rest folds one repos shard. Vercel / tests still drain every hop
// in-process. See docs/VERCEL-DATA-OPERATIONS.md §4 / §3.3.

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

const PACK_PHASES = new Set<RecomputePhase>(["month", "year", "week"]);
const WINDOW_PHASES = new Set<RecomputePhase>(["month", "monthOrg", "year", "yearOrg", "week", "weekOrg", "rest"]);

export function recomputeStepCheckpointName(cursor: RefreshCursor): string {
  const phase = cursor.recomputePhase ?? "month";
  if (PACK_PHASES.has(phase) && cursor.recomputeOffset === undefined) return `recomputeRank-${phase}-pack`;
  if (WINDOW_PHASES.has(phase) && typeof cursor.recomputeOffset === "number") {
    return `recomputeRank-${phase}-${cursor.recomputeOffset}`;
  }
  return `recomputeRank-${phase}`;
}

export function recomputeStartCheckpointName(cursor: RefreshCursor): string {
  const phase = recomputePhaseOf(cursor);
  if (PACK_PHASES.has(phase) && cursor.recomputeOffset === undefined) return `recomputeRank-${phase}-start`;
  return `${recomputeStepCheckpointName(cursor)}-start`;
}

export function extraRecomputeCheckpointSteps(
  cursor: RefreshCursor,
  result: { [key: string]: unknown },
): string[] {
  const current = recomputePhaseOf(cursor);
  const extra: string[] = [];
  if (current === "month" && result.nextRecomputePhase === "monthOrg") extra.push("recomputeRank-month");
  if (current === "monthOrg" && result.nextRecomputePhase === "year") extra.push("recomputeRank-monthOrg");
  if (current === "year" && result.nextRecomputePhase === "yearOrg") extra.push("recomputeRank-year");
  if (current === "yearOrg" && result.nextRecomputePhase === "week") extra.push("recomputeRank-yearOrg");
  if (current === "week" && result.nextRecomputePhase === "weekOrg") extra.push("recomputeRank-week");
  if (current === "weekOrg" && result.nextRecomputePhase === "rest") extra.push("recomputeRank-weekOrg");
  if (current === "rest" && !hasNextRecomputeWindow(result)) extra.push("recomputeRank-rest");
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

type StreamedRepoPhase = "month" | "week" | "year";
type StreamedOrgPhase = "monthOrg" | "weekOrg" | "yearOrg";

async function rankStreamedRepos(
  runId: string,
  owner: { runId: string; fencingToken: number },
  kind: PackedWindowKind,
  phase: StreamedRepoPhase,
  offset: number,
  generatedAt: string,
  done: RecomputeRankStepFields,
): Promise<RecomputeRankStepFields> {
  const meta = await readPackedWindowMeta(runId, kind);
  if (!meta) throw new Error(`ops/workflows/${runId}/recompute/${kind}-win/meta.json: missing persist`);
  if (offset >= meta.periods.length) return { ...done, files: 0 };
  const to = Math.min(offset + WEEK_RANK_PERIODS_PER_HOP, meta.periods.length);
  const rows = await streamPackedRepoPeriodRows(runId, kind, offset, to, owner);
  const carry = await readRankCarry(runId, kind, "repo");
  let prevFlow = pairsToRankMap(carry?.flow);
  let prevStock = pairsToRankMap(carry?.stock);
  let files = 0;
  for (let i = 0; i < rows.length; i++) {
    const ranked = repoRankViewsFromPeriodRows(meta.periods[offset + i]!, rows[i]!, phase, generatedAt, prevFlow, prevStock);
    files += await writeVersionAndClear(runId, ranked.views, owner);
    prevFlow = ranked.nextFlow;
    prevStock = ranked.nextStock;
    rows[i] = [];
  }
  if (to < meta.periods.length) {
    await writeRankCarry(owner, {
      v: 1,
      kind,
      dim: "repo",
      nextPeriod: to,
      flow: prevFlow ? [...prevFlow] : [],
      stock: prevStock ? [...prevStock] : [],
    });
    return { files, nextRecomputePhase: phase, nextRecomputeOffset: to };
  }
  return { ...done, files };
}

async function rankStreamedOrgs(
  runId: string,
  owner: { runId: string; fencingToken: number },
  kind: PackedWindowKind,
  phase: StreamedOrgPhase,
  w: "month" | "week" | "year",
  offset: number,
  generatedAt: string,
  done: RecomputeRankStepFields,
): Promise<RecomputeRankStepFields> {
  const meta = await readPackedWindowMeta(runId, kind);
  if (!meta) throw new Error(`ops/workflows/${runId}/recompute/${kind}-win/meta.json: missing persist`);
  if (offset >= meta.periods.length) return { ...done, files: 0 };
  const to = Math.min(offset + WEEK_RANK_PERIODS_PER_HOP, meta.periods.length);
  const carryFile = await readRankCarry(runId, kind, "org");
  const orgStock = orgStockToMap(carryFile?.orgStock);
  const rows = await streamPackedOrgPeriodRows(runId, kind, offset, to, orgStock, owner);
  let prevFlow = pairsToRankMap(carryFile?.flow);
  let prevStock = pairsToRankMap(carryFile?.stock);
  let files = 0;
  for (let i = 0; i < rows.length; i++) {
    const ranked = orgRankViewsFromPeriodRows(meta.periods[offset + i]!, rows[i]!, w, generatedAt, prevFlow, prevStock);
    files += await writeVersionAndClear(runId, ranked.views, owner);
    prevFlow = ranked.nextFlow;
    prevStock = ranked.nextStock;
    rows[i] = [];
  }
  if (to < meta.periods.length) {
    await writeRankCarry(owner, {
      v: 1,
      kind,
      dim: "org",
      nextPeriod: to,
      flow: prevFlow ? [...prevFlow] : [],
      stock: prevStock ? [...prevStock] : [],
      orgStock: [...orgStock],
    });
    return { files, nextRecomputePhase: phase, nextRecomputeOffset: to };
  }
  return { ...done, files };
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
      if (cursor.recomputeOffset === undefined) {
        await ensurePackedWindowPersisted(runId, "month", owner);
        const files = await writeStreamedGrowthViews(runId, "month", "month", generatedAt, owner);
        return { files, nextRecomputePhase: "month", nextRecomputeOffset: 0 };
      }
      return rankStreamedRepos(runId, owner, "month", "month", cursor.recomputeOffset, generatedAt, {
        files: 0,
        nextRecomputePhase: "monthOrg",
        nextRecomputeOffset: 0,
      });
    }
    case "monthOrg": {
      return rankStreamedOrgs(runId, owner, "month", "monthOrg", "month", cursor.recomputeOffset ?? 0, generatedAt, {
        files: 0,
        nextRecomputePhase: "year",
      });
    }
    case "year": {
      if (cursor.recomputeOffset === undefined) {
        await ensurePackedWindowPersisted(runId, "month", owner);
        await ensurePackedWindowPersisted(runId, "year", owner);
        const files = await writeStreamedGrowthViews(runId, "year", "year", generatedAt, owner);
        return { files, nextRecomputePhase: "year", nextRecomputeOffset: 0 };
      }
      return rankStreamedRepos(runId, owner, "year", "year", cursor.recomputeOffset, generatedAt, {
        files: 0,
        nextRecomputePhase: "yearOrg",
        nextRecomputeOffset: 0,
      });
    }
    case "yearOrg": {
      return rankStreamedOrgs(runId, owner, "year", "yearOrg", "year", cursor.recomputeOffset ?? 0, generatedAt, {
        files: 0,
        nextRecomputePhase: "week",
      });
    }
    case "week": {
      if (cursor.recomputeOffset === undefined) {
        await ensurePackedWindowPersisted(runId, "week", owner);
        return { files: 0, nextRecomputePhase: "week", nextRecomputeOffset: 0 };
      }
      return rankStreamedRepos(runId, owner, "week", "week", cursor.recomputeOffset, generatedAt, {
        files: 0,
        nextRecomputePhase: "weekOrg",
        nextRecomputeOffset: 0,
      });
    }
    case "weekOrg": {
      return rankStreamedOrgs(runId, owner, "week", "weekOrg", "week", cursor.recomputeOffset ?? 0, generatedAt, {
        files: 0,
        nextRecomputePhase: "rest",
        nextRecomputeOffset: 0,
      });
    }
    case "rest": {
      return runRestRankHop(runId, owner, cursor.recomputeOffset ?? 0, generatedAt);
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
