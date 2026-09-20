import { nextRefreshJob } from "./graph";
import type { WorkflowFetch } from "./http";
import { firstRefreshJob, type RefreshGraph, type RefreshStepJob, type RefreshStepResult, type WorkflowRuntime } from "./types";

export type CfQueueSender = (job: RefreshStepJob) => Promise<void>;

export class CfQueueWorkflowRuntime implements WorkflowRuntime {
  constructor(private readonly send: CfQueueSender) {}

  async startRefresh(runId: string, graph: RefreshGraph = "full"): Promise<void> {
    await this.enqueueStep(firstRefreshJob(runId, graph));
  }

  async enqueueStep(job: RefreshStepJob): Promise<void> {
    await this.send(job);
  }

  async completeStep(job: RefreshStepJob, result: RefreshStepResult): Promise<void> {
    // Fallback for a direct POST /step (no queue-advance header). The CF Queue
    // consumer owns the successor after a 200 body so fold does not depend on
    // this public /enqueue hop from an exhausted OpenNext isolate.
    const next = nextRefreshJob(job, result);
    if (next) await this.enqueueStep(next);
  }
}

export function createCfQueueHttpSender(args: {
  enqueueUrl: string;
  secret: string;
  fetchImpl?: WorkflowFetch;
}): CfQueueSender {
  return async (job) => {
    const fetchImpl = args.fetchImpl ?? fetch;
    const response = await fetchImpl(args.enqueueUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${args.secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(job),
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`CF queue enqueue failed: HTTP ${response.status}`);
    }
  };
}
