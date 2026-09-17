import { nextRefreshJob } from "./graph";
import { firstRefreshJob, type RefreshGraph, type RefreshStepJob, type RefreshStepResult, type ScheduleFn, type WorkflowRuntime } from "./types";

export type WorkflowFetch = (url: URL | string, init?: RequestInit) => Promise<Response>;

export type HttpWorkflowRuntimeOptions = {
  baseUrl: string;
  secret: string;
  schedule?: ScheduleFn;
  fetchImpl?: WorkflowFetch;
  bypassSecret?: string;
};

export class HttpWorkflowRuntime implements WorkflowRuntime {
  constructor(private readonly options: HttpWorkflowRuntimeOptions) {}

  async startRefresh(runId: string, graph: RefreshGraph = "full"): Promise<void> {
    await this.enqueueStep(firstRefreshJob(runId, graph));
  }

  async enqueueStep(job: RefreshStepJob): Promise<void> {
    const task = () => this.postStep(job);
    if (this.options.schedule) {
      this.options.schedule(task);
      return;
    }
    await task();
  }

  async completeStep(job: RefreshStepJob, result: RefreshStepResult): Promise<void> {
    const next = nextRefreshJob(job, result);
    if (next) await this.enqueueStep(next);
  }

  private async postStep(job: RefreshStepJob): Promise<void> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.options.secret}`,
      "content-type": "application/json",
    };
    if (this.options.bypassSecret) headers["x-vercel-protection-bypass"] = this.options.bypassSecret;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const response = await fetchImpl(new URL("/api/workflows/refresh/step", this.options.baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify(job),
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`refresh step ${job.name} enqueue failed: HTTP ${response.status}`);
    }
  }
}
