import { putView } from "@/lib/data/write";
import { getBlobBaseUrl } from "@/lib/runtime-config";
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
  const existing = await readSyncRuns();
  const runs = [run, ...existing.runs.filter((item) => item.id !== run.id)].slice(0, MAX_RUNS);
  await putView(SYNC_RUNS_PATH, {
    generated_at: new Date().toISOString(),
    runs,
  });
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
    error: error instanceof Error ? error.message : "Unexpected cron failure",
  };
}

export async function safeRecordSyncRun(run: SyncRun): Promise<string | null> {
  try {
    await recordSyncRun(run);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Failed to record sync run";
  }
}

async function readSyncRuns(): Promise<SyncRunsFile> {
  const base = getBlobBaseUrl();
  if (!base) return { generated_at: new Date().toISOString(), runs: [] };

  const url = `${base}/${SYNC_RUNS_PATH}?v=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return { generated_at: new Date().toISOString(), runs: [] };
  if (!res.ok) throw new Error(`sync-runs fetch failed: ${res.status}`);

  const json = (await res.json()) as Partial<SyncRunsFile>;
  return {
    generated_at: typeof json.generated_at === "string" ? json.generated_at : new Date().toISOString(),
    runs: Array.isArray(json.runs) ? (json.runs as SyncRun[]) : [],
  };
}
