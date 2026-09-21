import { REPO_BUCKETS } from "../buckets";
import {
  RECOMPUTE_PHASE_SET,
  type CanonicalPreflightCursorAcc,
  type FixtureRefreshStepName,
  type FoldCursorAcc,
  type FoldPhase,
  type FullRefreshStepName,
  type RecomputePhase,
  type RefreshCursor,
  type RefreshStepJob,
  type RefreshStepResult,
} from "./types";

function asPreflightAcc(value: unknown): CanonicalPreflightCursorAcc | undefined {
  if (!value || typeof value !== "object") return undefined;
  const acc = value as CanonicalPreflightCursorAcc;
  if (
    typeof acc.repoRecords !== "number" ||
    typeof acc.monthlyRecords !== "number" ||
    typeof acc.weeklyRecords !== "number" ||
    typeof acc.recentDailyRecords !== "number" ||
    typeof acc.validatedShards !== "number" ||
    typeof acc.schemaFailures !== "number"
  ) {
    return undefined;
  }
  return acc;
}

function asFoldAcc(value: unknown): FoldCursorAcc | undefined {
  if (!value || typeof value !== "object") return undefined;
  const acc = value as FoldCursorAcc;
  if (
    !Array.isArray(acc.folded) ||
    !Array.isArray(acc.foldedWeeks) ||
    typeof acc.foldedThroughMonth !== "string" ||
    typeof acc.foldedThroughWeek !== "string"
  ) {
    return undefined;
  }
  if (!acc.folded.every((item) => typeof item === "string")) return undefined;
  if (!acc.foldedWeeks.every((item) => typeof item === "string")) return undefined;
  return {
    folded: [...acc.folded],
    foldedWeeks: [...acc.foldedWeeks],
    foldedThroughMonth: acc.foldedThroughMonth,
    foldedThroughWeek: acc.foldedThroughWeek,
  };
}

function asFoldPhase(value: unknown): FoldPhase | undefined {
  if (value === "month" || value === "week") return value;
  return undefined;
}

function asRecomputePhase(value: unknown): RecomputePhase | undefined {
  if (typeof value === "string" && RECOMPUTE_PHASE_SET.has(value)) return value as RecomputePhase;
  return undefined;
}

function mergeCursor(job: RefreshStepJob, result: RefreshStepResult): RefreshCursor {
  return {
    ...job.cursor,
    startedAt: result.startedAt ?? job.cursor.startedAt,
    fencingToken: result.fencingToken ?? job.cursor.fencingToken,
  };
}

function nextFullName(name: FullRefreshStepName): FullRefreshStepName | null {
  switch (name) {
    case "startRun":
      return "preflight";
    case "preflight":
      return "whitelist";
    case "whitelist":
      return "rename";
    case "rename":
      return "metadata";
    case "metadata":
      return "fold";
    case "fold":
      return "recomputeRank";
    case "recomputeRank":
      return "recomputeRepoEntities";
    case "recomputeRepoEntities":
      return "recomputeOrgEntities";
    case "recomputeOrgEntities":
      return "recomputeHeatmap";
    case "recomputeHeatmap":
      return "aliases";
    case "aliases":
      return "validate";
    case "validate":
      return "publish";
    case "publish":
      return "gc";
    case "gc":
      return "markPublished";
    case "markPublished":
      return null;
    default: {
      const _exhaustive: never = name;
      throw new Error(`unhandled full refresh step: ${String(_exhaustive)}`);
    }
  }
}

function nextFixtureName(name: FixtureRefreshStepName): FixtureRefreshStepName | null {
  switch (name) {
    case "startRun":
      return "writeViews";
    case "writeViews":
      return "complete";
    case "complete":
      return null;
    default: {
      const _exhaustive: never = name;
      throw new Error(`unhandled fixture refresh step: ${String(_exhaustive)}`);
    }
  }
}

export function nextRefreshJob(
  job: RefreshStepJob,
  result: RefreshStepResult,
  buckets = REPO_BUCKETS,
): RefreshStepJob | null {
  const cursor = mergeCursor(job, result);
  if (job.graph === "fixture") {
    const name = nextFixtureName(job.name);
    if (!name) return null;
    return { v: 1, graph: "fixture", runId: job.runId, name, attempt: 0, cursor };
  }

  if (job.name === "preflight") {
    if (typeof result.nextPreflightOffset === "number") {
      return {
        v: 1,
        graph: "full",
        runId: job.runId,
        name: "preflight",
        attempt: 0,
        cursor: {
          ...cursor,
          preflightOffset: result.nextPreflightOffset,
          preflightAcc: asPreflightAcc(result.preflightAcc) ?? cursor.preflightAcc,
        },
      };
    }
    const { preflightOffset: _offset, preflightAcc: _acc, ...rest } = cursor;
    return { v: 1, graph: "full", runId: job.runId, name: "whitelist", attempt: 0, cursor: rest };
  }

  if (job.name === "metadata") {
    const bucket = job.cursor.bucket ?? 0;
    const metadata = {
      repos: (job.cursor.metadata?.repos ?? 0) + (result.repos ?? 0),
      historical: (job.cursor.metadata?.historical ?? 0) + (result.historical ?? 0),
      fromGithub: (job.cursor.metadata?.fromGithub ?? 0) + (result.from_github ?? 0),
    };
    if (bucket + 1 < buckets) {
      return {
        v: 1,
        graph: "full",
        runId: job.runId,
        name: "metadata",
        attempt: 0,
        cursor: { ...cursor, bucket: bucket + 1, metadata },
      };
    }
    return {
      v: 1,
      graph: "full",
      runId: job.runId,
      name: "fold",
      attempt: 0,
      cursor: { ...cursor, bucket: undefined, metadata },
    };
  }

  if (job.name === "rename") {
    return {
      v: 1,
      graph: "full",
      runId: job.runId,
      name: "metadata",
      attempt: 0,
      cursor: { ...cursor, bucket: 0, metadata: { repos: 0, historical: 0, fromGithub: 0 } },
    };
  }

  if (job.name === "fold") {
    const nextPhase = asFoldPhase(result.nextFoldPhase);
    if (nextPhase || typeof result.nextFoldOffset === "number") {
      return {
        v: 1,
        graph: "full",
        runId: job.runId,
        name: "fold",
        attempt: 0,
        cursor: {
          ...cursor,
          foldPhase: nextPhase ?? cursor.foldPhase ?? "month",
          foldMonth: typeof result.nextFoldMonth === "string" ? result.nextFoldMonth : cursor.foldMonth,
          foldOffset: typeof result.nextFoldOffset === "number" ? result.nextFoldOffset : 0,
          foldSeq: typeof result.nextFoldSeq === "number" ? result.nextFoldSeq : (cursor.foldSeq ?? 0) + 1,
          foldAcc: asFoldAcc(result.foldAcc) ?? cursor.foldAcc,
        },
      };
    }
    const {
      foldPhase: _foldPhase,
      foldMonth: _foldMonth,
      foldOffset: _foldOffset,
      foldSeq: _foldSeq,
      foldAcc: _foldAcc,
      ...rest
    } = cursor;
    return { v: 1, graph: "full", runId: job.runId, name: "recomputeRank", attempt: 0, cursor: rest };
  }

  if (job.name === "recomputeRank") {
    const nextPhase = asRecomputePhase(result.nextRecomputePhase);
    if (nextPhase || typeof result.nextRecomputeOffset === "number") {
      return {
        v: 1,
        graph: "full",
        runId: job.runId,
        name: "recomputeRank",
        attempt: 0,
        cursor: {
          ...cursor,
          recomputePhase: nextPhase ?? cursor.recomputePhase ?? "month",
          recomputeOffset: typeof result.nextRecomputeOffset === "number" ? result.nextRecomputeOffset : undefined,
        },
      };
    }
    const { recomputePhase: _recomputePhase, recomputeOffset: _recomputeOffset, ...rest } = cursor;
    return { v: 1, graph: "full", runId: job.runId, name: "recomputeRepoEntities", attempt: 0, cursor: rest };
  }

  const name = nextFullName(job.name);
  if (!name) return null;
  return { v: 1, graph: "full", runId: job.runId, name, attempt: 0, cursor };
}
