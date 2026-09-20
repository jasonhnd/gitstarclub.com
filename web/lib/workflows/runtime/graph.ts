import { REPO_BUCKETS } from "../buckets";
import type {
  CanonicalPreflightCursorAcc,
  FixtureRefreshStepName,
  FullRefreshStepName,
  RefreshCursor,
  RefreshStepJob,
  RefreshStepResult,
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

  const name = nextFullName(job.name);
  if (!name) return null;
  return { v: 1, graph: "full", runId: job.runId, name, attempt: 0, cursor };
}
