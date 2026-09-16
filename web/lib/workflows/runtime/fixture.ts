import { WorkflowManifest } from "@/lib/contracts";
import { MemoryObjectStore, type ObjectStore } from "@/lib/storage";
import {
  BlobWorkflowLeaseStore,
  claimWorkflowLease,
  releaseWorkflowLease,
  renewWorkflowLease,
  type WorkflowLeaseStore,
} from "@/lib/workflows/lease";
import type { FixtureRefreshStepName, RefreshStepJob, RefreshStepResult } from "./types";

async function putJson(store: ObjectStore, path: string, data: unknown): Promise<void> {
  await store.put(path, JSON.stringify(data), {
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

const FIXTURE_STEPS = ["startRun", "writeViews", "complete"];

export type FixtureDeps = {
  objects: ObjectStore;
  leaseStore: WorkflowLeaseStore;
  now: () => Date;
};

export function createFixtureDeps(objects: ObjectStore = new MemoryObjectStore()): FixtureDeps {
  return {
    objects,
    leaseStore: new BlobWorkflowLeaseStore(undefined, objects),
    now: () => new Date(),
  };
}

export async function executeFixtureStep(
  job: Extract<RefreshStepJob, { graph: "fixture" }>,
  deps: FixtureDeps,
): Promise<RefreshStepResult> {
  const name: FixtureRefreshStepName = job.name;
  switch (name) {
    case "startRun": {
      const acquiredAt = deps.now().toISOString();
      const claim = await claimWorkflowLease(
        {
          runId: job.runId,
          acquiredAt,
          idempotencyKey: `run:${job.runId}`,
          trigger: "fixture",
          allowExistingRun: true,
          now: Date.parse(acquiredAt),
        },
        deps.leaseStore,
      );
      if (claim.status === "rejected") {
        throw new Error(`workflow ${claim.lease.run_id} is already running until ${claim.lease.expires_at}`);
      }
      const manifest = WorkflowManifest.parse({
        run_id: job.runId,
        started_at: acquiredAt,
        status: "running",
        steps: FIXTURE_STEPS,
        published_version: null,
      });
      await putJson(deps.objects, `ops/workflows/${job.runId}/manifest.json`, manifest);
      return { name, startedAt: acquiredAt, fencingToken: claim.lease.fencing_token };
    }
    case "writeViews": {
      if (job.cursor.fencingToken === undefined) throw new Error(`fixture ${job.runId} is missing a fencing token`);
      await renewWorkflowLease(job.runId, job.cursor.fencingToken, deps.leaseStore, deps.now().toISOString());
      await putJson(deps.objects, `views/${job.runId}/meta.json`, {
        run_id: job.runId,
        schema_ver: 1,
        generated_at: deps.now().toISOString(),
      });
      return { name, ok: true, files: 1 };
    }
    case "complete": {
      if (!job.cursor.startedAt || job.cursor.fencingToken === undefined) {
        throw new Error(`fixture ${job.runId} is missing lease cursor before complete`);
      }
      const manifest = WorkflowManifest.parse({
        run_id: job.runId,
        started_at: job.cursor.startedAt,
        status: "published",
        steps: FIXTURE_STEPS,
        published_version: job.runId,
      });
      await putJson(deps.objects, `ops/workflows/${job.runId}/manifest.json`, manifest);
      const released = await releaseWorkflowLease(
        job.runId,
        "published",
        deps.leaseStore,
        deps.now().toISOString(),
        job.cursor.fencingToken,
      );
      if (!released) throw new Error(`fixture ${job.runId} lost fencing token ${job.cursor.fencingToken}`);
      return { name, ok: true };
    }
    default: {
      const _exhaustive: never = name;
      throw new Error(`unhandled fixture refresh step: ${String(_exhaustive)}`);
    }
  }
}
