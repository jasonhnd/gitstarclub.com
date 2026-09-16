import { nextRefreshJob } from "./graph";
import { withStepRetry, type RetryPolicy } from "./retry";
import { firstRefreshJob, type RefreshGraph, type RefreshStepJob, type RefreshStepResult, type StepExecutor, type WorkflowRuntime } from "./types";

export class MemoryWorkflowRuntime implements WorkflowRuntime {
  readonly queue: RefreshStepJob[] = [];
  readonly completed: Array<{ job: RefreshStepJob; result: RefreshStepResult }> = [];

  async startRefresh(runId: string, graph: RefreshGraph = "full"): Promise<void> {
    await this.enqueueStep(firstRefreshJob(runId, graph));
  }

  async enqueueStep(job: RefreshStepJob): Promise<void> {
    this.queue.push(structuredClone(job));
  }

  async completeStep(job: RefreshStepJob, result: RefreshStepResult): Promise<void> {
    this.completed.push({ job: structuredClone(job), result: structuredClone(result) });
    const next = nextRefreshJob(job, result);
    if (next) await this.enqueueStep(next);
  }

  async drain(execute: StepExecutor, policy?: RetryPolicy): Promise<RefreshStepResult[]> {
    const results: RefreshStepResult[] = [];
    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) break;
      const result = await withStepRetry(job.name, () => execute(job), policy);
      results.push(result);
      await this.completeStep(job, result);
    }
    return results;
  }
}
