import {
  getCronSecret,
  getVercelAutomationBypassSecret,
  getWorkflowQueueEnqueueUrl,
  getWorkflowRuntimeKind,
  getWorkflowStepBaseUrl,
  requireCronSecret,
  requireWorkflowQueueEnqueueUrl,
  type WorkflowRuntimeKind,
} from "@/lib/runtime-config";
import { CfQueueWorkflowRuntime, createCfQueueHttpSender } from "./cf-queue";
import { HttpWorkflowRuntime, type WorkflowFetch } from "./http";
import { MemoryWorkflowRuntime } from "./memory";
import type { ScheduleFn, WorkflowRuntime } from "./types";

export type ResolveWorkflowRuntimeOptions = {
  requestUrl?: string;
  schedule?: ScheduleFn;
  fetchImpl?: WorkflowFetch;
  env?: NodeJS.ProcessEnv;
  kind?: WorkflowRuntimeKind;
};

function stepBaseUrl(opts: ResolveWorkflowRuntimeOptions): string {
  const fromEnv = getWorkflowStepBaseUrl(opts.env);
  if (fromEnv) return fromEnv;
  if (opts.requestUrl) return new URL(opts.requestUrl).origin;
  throw new Error("WORKFLOW_STEP_BASE_URL is required when the request origin is unavailable");
}

export function resolveWorkflowRuntime(opts: ResolveWorkflowRuntimeOptions = {}): WorkflowRuntime {
  const kind = opts.kind ?? getWorkflowRuntimeKind(opts.env);
  switch (kind) {
    case "memory":
      return new MemoryWorkflowRuntime();
    case "http":
      return new HttpWorkflowRuntime({
        baseUrl: stepBaseUrl(opts),
        secret: requireCronSecret(opts.env),
        schedule: opts.schedule,
        fetchImpl: opts.fetchImpl,
        bypassSecret: getVercelAutomationBypassSecret(opts.env),
      });
    case "cf-queue": {
      const secret = requireCronSecret(opts.env);
      const enqueueUrl = requireWorkflowQueueEnqueueUrl(opts.env);
      return new CfQueueWorkflowRuntime(
        createCfQueueHttpSender({
          enqueueUrl,
          secret,
          fetchImpl: opts.fetchImpl,
        }),
      );
    }
    default: {
      const _exhaustive: never = kind;
      throw new Error(`unsupported WORKFLOW_RUNTIME: ${String(_exhaustive)}`);
    }
  }
}

export function describeWorkflowRuntime(opts: ResolveWorkflowRuntimeOptions = {}): {
  kind: WorkflowRuntimeKind;
  queueEnqueueUrl?: string;
  cronConfigured: boolean;
} {
  return {
    kind: opts.kind ?? getWorkflowRuntimeKind(opts.env),
    queueEnqueueUrl: getWorkflowQueueEnqueueUrl(opts.env),
    cronConfigured: Boolean(getCronSecret(opts.env)),
  };
}
