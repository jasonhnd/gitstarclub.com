export type RefreshJob = {
  v: 1;
  graph: "full" | "fixture";
  runId: string;
  name: string;
  attempt: number;
  cursor: Record<string, unknown>;
};

export type InvalidateOp = {
  kind: "path" | "tag";
  path?: string;
  tag?: string;
};

export type InvalidateBody = {
  v?: number;
  driver?: string;
  ops?: InvalidateOp[];
  paths?: string[];
  tags?: string[];
};

export type WorkerEnv = {
  JOBS: {
    send(message: RefreshJob): Promise<void>;
  };
  MEDIA: unknown;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  WORKER_SELF_REFERENCE?: { fetch(request: Request): Promise<Response> };
  CRON_SECRET?: string;
  CF_CRON_ORIGIN?: string;
  REFRESH_START_URL?: string;
  REFRESH_STEP_URL?: string;
  WORKFLOW_FIXTURE?: string;
  CF_PREVIEW_COMMIT_SHA?: string;
  CF_PREVIEW_ORIGIN?: string;
  HOSTING_TARGET?: string;
  BLOB_BASE_URL?: string;
  MIN_TRACKED_STARS?: string;
  WHITELIST_SEARCH_SHARDS?: string;
  WHITELIST_SEARCH_HOP_BUDGET_MS?: string;
  PREFLIGHT_RELAX_EMPTY_SHARDS?: string;
  WORKFLOW_COLD_START?: string;
};
