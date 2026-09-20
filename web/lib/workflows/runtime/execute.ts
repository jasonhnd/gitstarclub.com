import { sendAlert } from "@/lib/observability/alert";
import { markFailed, markPublished, startRun } from "@/lib/workflows/checkpoint";
import { WorkflowLeaseOwnershipError } from "@/lib/workflows/lease";
import { buildAliases } from "@/lib/workflows/steps/aliases";
import { runFoldStep } from "@/lib/workflows/steps/fold";
import { gcVersions } from "@/lib/workflows/steps/gc";
import { refreshMetadataBucket } from "@/lib/workflows/steps/metadata";
import { runPreflightStep } from "@/lib/workflows/steps/preflight";
import { publishVersion } from "@/lib/workflows/steps/publish";
import { recomputeOrgEntities, recomputeRepoEntities } from "@/lib/workflows/steps/recompute-entity";
import { recomputeHeatmap } from "@/lib/workflows/steps/recompute-heatmap";
import { recomputeRank } from "@/lib/workflows/steps/recompute-rank";
import { detectRenames } from "@/lib/workflows/steps/rename";
import { validateVersion } from "@/lib/workflows/steps/validate";
import { refreshWhitelist } from "@/lib/workflows/steps/whitelist";
import type { FullRefreshStepName, RefreshStepJob, RefreshStepResult } from "./types";

function requireToken(job: RefreshStepJob): number {
  if (job.cursor.fencingToken === undefined) {
    throw new WorkflowLeaseOwnershipError(`refresh ${job.runId} is missing a fencing token before ${job.name}`);
  }
  return job.cursor.fencingToken;
}

export async function executeRefreshStep(job: Extract<RefreshStepJob, { graph: "full" }>): Promise<RefreshStepResult> {
  const runId = job.runId;
  const name: FullRefreshStepName = job.name;
  switch (name) {
    case "startRun": {
      const started = await startRun(runId);
      return { name, startedAt: started.startedAt, fencingToken: started.fencingToken };
    }
    case "preflight":
      return { name, ...(await runPreflightStep(runId, job.cursor)) };
    case "whitelist":
      return { name, ...(await refreshWhitelist(runId, requireToken(job))) };
    case "rename":
      return { name, ...(await detectRenames(runId, requireToken(job))) };
    case "metadata": {
      const bucket = job.cursor.bucket ?? 0;
      return { name, ...(await refreshMetadataBucket(runId, bucket, requireToken(job))) };
    }
    case "fold":
      return { name, ...(await runFoldStep(runId, requireToken(job), job.cursor)) };
    case "recomputeRank":
      return { name, ...(await recomputeRank(runId, requireToken(job))) };
    case "recomputeRepoEntities":
      return { name, ...(await recomputeRepoEntities(runId, requireToken(job))) };
    case "recomputeOrgEntities":
      return { name, ...(await recomputeOrgEntities(runId, requireToken(job))) };
    case "recomputeHeatmap":
      return { name, ...(await recomputeHeatmap(runId, requireToken(job))) };
    case "aliases":
      return { name, ...(await buildAliases(runId, requireToken(job))) };
    case "validate":
      return { name, ...(await validateVersion(runId, requireToken(job))) };
    case "publish":
      return { name, ...(await publishVersion(runId, requireToken(job))) };
    case "gc": {
      const gc = await gcVersions(runId, requireToken(job));
      if (gc.error) {
        await sendAlert({ pipeline: "workflow-refresh", title: "version gc failed", run_id: runId, step: "gc", error: gc.error });
      }
      return { name, ...gc };
    }
    case "markPublished": {
      if (!job.cursor.startedAt) throw new Error(`refresh ${runId} is missing startedAt before markPublished`);
      await markPublished(runId, job.cursor.startedAt, requireToken(job));
      return { name, ok: true };
    }
    default: {
      const _exhaustive: never = name;
      throw new Error(`unhandled full refresh step: ${String(_exhaustive)}`);
    }
  }
}

export async function failRefreshJob(job: RefreshStepJob, error: unknown): Promise<void> {
  if (job.graph !== "full" || !job.cursor.startedAt || job.cursor.fencingToken === undefined) return;
  const message = error instanceof Error ? error.message : String(error);
  await markFailed(job.runId, job.cursor.startedAt, message, job.cursor.fencingToken);
}
