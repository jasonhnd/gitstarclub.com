import { loadCanonicalModel, writeVersion } from "../recompute/io";
import { computeCategoryViews } from "../recompute";
import { allTime, growth, newcomers, orgRankMatrix, repoRankMatrix } from "../recompute/ranks";
import { computeOrgWindow, computeRepoWindow, deriveYearWindow } from "../recompute/windows";
import type { RecomputePhase, RefreshCursor } from "@/lib/workflows/runtime/types";

// Rank recompute (cross-bucket gather). CF hops load only the families they need:
// month+year (repos+monthly), week (repos+weekly ~33 MiB), rest (repos). A single
// isolate that also held weekly + month windows + category views is what OOM'd
// after #484's no-op fold. Vercel / tests still drain every hop in-process.
// See docs/VERCEL-DATA-OPERATIONS.md §4 / §3.3.

export type RecomputeRankStepFields = {
  files: number;
  nextRecomputePhase?: RecomputePhase;
};

export const RECOMPUTE_RANK_FAMILIES = {
  month: ["repos", "monthly"],
  week: ["repos", "weekly"],
  rest: ["repos"],
} as const;

export function recomputeStepCheckpointName(cursor: RefreshCursor): string {
  return `recomputeRank-${cursor.recomputePhase ?? "month"}`;
}

export function hasNextRecomputeWindow(result: { [key: string]: unknown }): boolean {
  return result.nextRecomputePhase === "month" || result.nextRecomputePhase === "week" || result.nextRecomputePhase === "rest";
}

function recomputePhaseOf(cursor: RefreshCursor): RecomputePhase {
  if (cursor.recomputePhase === "week" || cursor.recomputePhase === "rest") return cursor.recomputePhase;
  return "month";
}

export async function runRecomputeRankStep(
  runId: string,
  fencingToken: number,
  cursor: RefreshCursor = {},
): Promise<RecomputeRankStepFields> {
  const phase = recomputePhaseOf(cursor);
  const generatedAt = new Date().toISOString();
  const owner = { runId, fencingToken };
  switch (phase) {
    case "month": {
      const { model } = await loadCanonicalModel(runId, { families: RECOMPUTE_RANK_FAMILIES.month });
      const monthWin = computeRepoWindow(model, "month");
      const yearWin = deriveYearWindow(model, monthWin);
      const views = new Map<string, unknown>();
      for (const [path, view] of repoRankMatrix(monthWin, "month", generatedAt)) views.set(path, view);
      for (const [path, view] of orgRankMatrix(computeOrgWindow(model, monthWin), "month", generatedAt)) views.set(path, view);
      for (const [path, view] of repoRankMatrix(yearWin, "year", generatedAt)) views.set(path, view);
      for (const [path, view] of orgRankMatrix(computeOrgWindow(model, yearWin), "year", generatedAt)) views.set(path, view);
      for (const [path, view] of growth(monthWin, "month", generatedAt)) views.set(path, view);
      for (const [path, view] of growth(yearWin, "year", generatedAt)) views.set(path, view);
      const files = await writeVersion(runId, views, owner);
      return { files, nextRecomputePhase: "week" };
    }
    case "week": {
      const { model } = await loadCanonicalModel(runId, { families: RECOMPUTE_RANK_FAMILIES.week });
      const weekWin = computeRepoWindow(model, "week");
      const views = new Map<string, unknown>();
      for (const [path, view] of repoRankMatrix(weekWin, "week", generatedAt)) views.set(path, view);
      for (const [path, view] of orgRankMatrix(computeOrgWindow(model, weekWin), "week", generatedAt)) views.set(path, view);
      const files = await writeVersion(runId, views, owner);
      return { files, nextRecomputePhase: "rest" };
    }
    case "rest": {
      const { model } = await loadCanonicalModel(runId, { families: RECOMPUTE_RANK_FAMILIES.rest });
      const views = new Map<string, unknown>(allTime(model, generatedAt));
      for (const [path, view] of newcomers(model, "month", generatedAt)) views.set(path, view);
      for (const [path, view] of newcomers(model, "year", generatedAt)) views.set(path, view);
      for (const [path, view] of computeCategoryViews(model, generatedAt)) views.set(path, view);
      const files = await writeVersion(runId, views, owner);
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
