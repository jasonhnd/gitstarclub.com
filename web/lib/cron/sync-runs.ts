import { putView } from "@/lib/data/write";
import { BLOB_JSON_FETCH_TIMEOUT_MS, fetchWithTimeout } from "@/lib/fetch-timeout.mjs";
import { sanitizeErrorText } from "@/lib/observability/sanitize-error";
import { getPublicReadBases, getStorageReadDriver } from "@/lib/runtime-config";
import type { LiveRefreshJob, LiveRefreshResult } from "./live-refresh";

const SYNC_RUNS_PATH = "ops/sync-runs.json";
const MAX_RUNS = 100;

type SyncRunStatus = "ok" | "error";

type SyncRun = {
  id: string;
  job: LiveRefreshJob;
  status: SyncRunStatus;
  dry: boolean;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  result?: LiveRefreshResult;
  error?: string;
};

type SyncRunsFile = {
  generated_at: string;
  runs: SyncRun[];
};

export async function recordSyncRun(run: SyncRun): Promise<void> {
  const safeRun = sanitizeStoredRun(run);
  const existing = await readSyncRuns();
  const runs = [safeRun, ...existing.runs.filter((item) => item.id !== safeRun.id).map(sanitizeStoredRun)].slice(0, MAX_RUNS);
  await putView(SYNC_RUNS_PATH, {
    generated_at: new Date().toISOString(),
    runs,
  });
}

export function sanitizeLiveRefreshResult(result: LiveRefreshResult): LiveRefreshResult {
  let changed = false;
  const post_commit_errors = result.post_commit_errors.map((item) => {
    const safe = sanitizeErrorText(item);
    if (safe !== item) changed = true;
    return safe;
  });
  return changed ? { ...result, post_commit_errors } : result;
}

function sanitizeStoredRun(run: SyncRun): SyncRun {
  const error = typeof run.error === "string" ? sanitizeErrorText(run.error) : undefined;
  const result = run.result ? sanitizeLiveRefreshResult(run.result) : undefined;
  if (error === undefined && result === undefined) return run;
  if (error === run.error && result === run.result) return run;
  return {
    ...run,
    ...(error !== undefined ? { error } : {}),
    ...(result !== undefined ? { result } : {}),
  };
}

export function syncRunId(job: LiveRefreshJob, startedAt: Date): string {
  return `${job}-${startedAt.toISOString().replaceAll(/[:.]/g, "-")}`;
}

export function completedRun(
  id: string,
  job: LiveRefreshJob,
  dry: boolean,
  startedAt: Date,
  result: LiveRefreshResult,
): SyncRun {
  const finishedAt = new Date();
  return {
    id,
    job,
    status: "ok",
    dry,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    result,
  };
}

export function failedRun(id: string, job: LiveRefreshJob, dry: boolean, startedAt: Date, error: unknown): SyncRun {
  const finishedAt = new Date();
  return {
    id,
    job,
    status: "error",
    dry,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    error: sanitizeErrorText(error instanceof Error ? error.message : "Unexpected cron failure"),
  };
}

export async function safeRecordSyncRun(run: SyncRun): Promise<string | null> {
  try {
    await recordSyncRun(run);
    return null;
  } catch (error) {
    return sanitizeErrorText(error instanceof Error ? error.message : "Failed to record sync run");
  }
}

function syncRunsReadBase(): string {
  try {
    return getPublicReadBases()[0] ?? "";
  } catch (error) {
    // A missing Blob base used to return empty history instead of throwing.
    if (getStorageReadDriver() === "blob") return "";
    throw error;
  }
}

async function readSyncRuns(): Promise<SyncRunsFile> {
  const base = syncRunsReadBase();
  if (!base) return { generated_at: new Date().toISOString(), runs: [] };

  const url = `${base}/${SYNC_RUNS_PATH}?v=${Date.now()}`;
  const res = await fetchWithTimeout(url, { cache: "no-store", timeoutMs: BLOB_JSON_FETCH_TIMEOUT_MS });
  if (res.status === 404) return { generated_at: new Date().toISOString(), runs: [] };
  if (!res.ok) throw new Error(`sync-runs fetch failed: ${res.status}`);

  const json = (await res.json()) as Partial<SyncRunsFile>;
  return {
    generated_at: typeof json.generated_at === "string" ? json.generated_at : new Date().toISOString(),
    runs: Array.isArray(json.runs) ? (json.runs as SyncRun[]) : [],
  };
}
