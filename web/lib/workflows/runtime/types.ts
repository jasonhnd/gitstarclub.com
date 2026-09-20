export const FULL_REFRESH_STEPS = [
  "startRun",
  "preflight",
  "whitelist",
  "rename",
  "metadata",
  "fold",
  "recomputeRank",
  "recomputeRepoEntities",
  "recomputeOrgEntities",
  "recomputeHeatmap",
  "aliases",
  "validate",
  "publish",
  "gc",
  "markPublished",
] as const;

export const FIXTURE_REFRESH_STEPS = ["startRun", "writeViews", "complete"] as const;

export type FullRefreshStepName = (typeof FULL_REFRESH_STEPS)[number];
export type FixtureRefreshStepName = (typeof FIXTURE_REFRESH_STEPS)[number];
export type RefreshGraph = "full" | "fixture";

export type CanonicalPreflightCursorAcc = {
  repoRecords: number;
  monthlyRecords: number;
  weeklyRecords: number;
  recentDailyRecords: number;
  validatedShards: number;
  schemaFailures: number;
};

export type RefreshCursor = {
  startedAt?: string;
  fencingToken?: number;
  bucket?: number;
  metadata?: {
    repos: number;
    historical: number;
    fromGithub: number;
  };
  preflightOffset?: number;
  preflightAcc?: CanonicalPreflightCursorAcc;
};

export type RefreshStepJob =
  | {
      v: 1;
      graph: "full";
      runId: string;
      name: FullRefreshStepName;
      attempt: number;
      cursor: RefreshCursor;
    }
  | {
      v: 1;
      graph: "fixture";
      runId: string;
      name: FixtureRefreshStepName;
      attempt: number;
      cursor: RefreshCursor;
    };

export type RefreshStepResult = {
  name: string;
  startedAt?: string;
  fencingToken?: number;
  repos?: number;
  historical?: number;
  from_github?: number;
  files?: number;
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
};

export type WorkflowRuntime = {
  startRefresh(runId: string, graph?: RefreshGraph): Promise<void>;
  enqueueStep(job: RefreshStepJob): Promise<void>;
  completeStep(job: RefreshStepJob, result: RefreshStepResult): Promise<void>;
};

export type StepExecutor = (job: RefreshStepJob) => Promise<RefreshStepResult>;

export type ScheduleFn = (task: () => Promise<void>) => void;

export function firstRefreshJob(runId: string, graph: RefreshGraph = "full"): RefreshStepJob {
  if (graph === "fixture") {
    return { v: 1, graph: "fixture", runId, name: "startRun", attempt: 0, cursor: {} };
  }
  return { v: 1, graph: "full", runId, name: "startRun", attempt: 0, cursor: {} };
}

export function isRefreshStepJob(value: unknown): value is RefreshStepJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<RefreshStepJob>;
  if (job.v !== 1 || typeof job.runId !== "string" || typeof job.attempt !== "number") return false;
  if (!job.cursor || typeof job.cursor !== "object") return false;
  if (job.graph === "full") {
    return (FULL_REFRESH_STEPS as readonly string[]).includes(job.name ?? "");
  }
  if (job.graph === "fixture") {
    return (FIXTURE_REFRESH_STEPS as readonly string[]).includes(job.name ?? "");
  }
  return false;
}
