import { setSystemTime, spyOn } from "bun:test";
import * as github from "@/lib/github";
import * as storage from "@/lib/storage";
import { MemoryObjectStore, type ObjectGetResult, type ObjectHeadResult, type ObjectListOptions, type ObjectPutOptions } from "@/lib/storage";
import { clearViewParseMemo } from "@/lib/data/parse-view";
import { invalidatePublishedVersionMemo } from "@/lib/data/source";
import { INDEXNOW_ENDPOINT, type IndexNowPayload } from "@/lib/indexnow";
import { REPO_BUCKETS, repoBucket } from "./buckets";
import { BlobWorkflowLeaseStore, WorkflowLeaseWriteCache, blobWorkflowLeaseStore } from "./lease";
import type { RefreshStepRouteOptions } from "./runtime/step-route";
import type { RefreshStepJob, RefreshStepResult } from "./runtime/types";

export const TEST_RUN = "refresh-2026-10-02-test";
export const PREVIOUS_RUN = "refresh-2025-01-01-test";
export const TEST_NOW = "2026-10-02T00:00:00.000Z";
export type FullJob = Extract<RefreshStepJob, { graph: "full" }>;

export const SUBREQUEST_LIMIT_ERROR = "Too many API requests by single Worker invocation";

/** Counts physical service operations, including failed attempts, per invocation. */
export class WorkflowSubrequestCounter {
  readonly counts: Record<string, number> = {};
  limit = Infinity;
  total = 0;

  reset(limit = Infinity): void {
    this.limit = limit;
    this.total = 0;
    for (const key of Object.keys(this.counts)) delete this.counts[key];
  }

  use(kind: string): void {
    this.total++;
    this.counts[kind] = (this.counts[kind] ?? 0) + 1;
    if (this.total > this.limit) throw new Error(SUBREQUEST_LIMIT_ERROR);
  }
}

/** Track the real object-store port, including CAS and physical deletions. */
export class WorkflowTestStore extends MemoryObjectStore {
  readonly contents: Record<string, string>;
  readonly reads: string[] = [];
  readonly writes: string[] = [];
  readonly deletions: string[] = [];
  failWrite?: (path: string) => boolean;
  readonly subrequests = new WorkflowSubrequestCounter();
  failRead = false;
  failDelete = false;

  constructor(initial: Record<string, string> = {}) {
    super(initial);
    this.contents = { ...initial };
  }

  override async put(path: string, body: string | Uint8Array, options?: ObjectPutOptions) {
    this.subrequests.use("put");
    if (this.failWrite?.(path)) {
      this.failWrite = undefined;
      throw new Error(`injected write failure: ${path}`);
    }
    const result = await super.put(path, body, options);
    this.contents[path] = typeof body === "string" ? body : new TextDecoder().decode(body);
    this.writes.push(path);
    return result;
  }

  override async del(paths: string | string[]) {
    this.subrequests.use("delete");
    if (this.failDelete) {
      this.failDelete = false;
      throw new Error("injected delete failure");
    }
    await super.del(paths);
    for (const path of Array.isArray(paths) ? paths : [paths]) {
      delete this.contents[path];
      this.deletions.push(path);
    }
  }

  override async get(path: string): Promise<ObjectGetResult | null> {
    this.subrequests.use("get");
    return super.get(path);
  }

  async readPublic(path: string): Promise<ObjectGetResult | null> {
    this.subrequests.use("fetchRead");
    return super.get(path);
  }

  async getOrigin(path: string): Promise<ObjectGetResult | null> {
    return this.get(path);
  }

  override async head(path: string): Promise<ObjectHeadResult | null> {
    this.subrequests.use("head");
    return super.head(path);
  }

  override async list(options: ObjectListOptions) {
    this.subrequests.use("list");
    return super.list(options);
  }

  json<T = Record<string, unknown>>(path: string): T {
    const body = this.contents[path];
    if (body === undefined) throw new Error(`missing test artifact: ${path}`);
    return JSON.parse(body) as T;
  }

  async set(path: string, value: unknown) {
    await this.put(path, JSON.stringify(value));
  }
}

export function workflowSeed(repoCount = 1000, ownerCount = 1): Record<string, string> {
  const seed: Record<string, string> = {};
  const set = (path: string, value: unknown) => { seed[path] = JSON.stringify(value); };
  const repos = Array.from({ length: REPO_BUCKETS }, () => ({} as Record<string, unknown>));
  const monthly = Array.from({ length: REPO_BUCKETS }, () => ({} as Record<string, unknown>));
  const weekly = Array.from({ length: REPO_BUCKETS }, () => ({} as Record<string, unknown>));
  const daily = Array.from({ length: REPO_BUCKETS }, () => ({} as Record<string, unknown>));
  const lookup: Record<string, unknown> = {};
  const entries = [];
  const pending: Record<string, unknown> = {};
  // The real gate requires at least 1000 repositories. Ten final periods cross
  // the actual eight-period carry boundary; no gate threshold is overridden.
  for (let id = 1; id <= repoCount; id++) {
    const name = `repo-${id}`;
    const repoOwner = ownerCount === 1 ? "example" : `owner-${id % ownerCount}`;
    const entry = { owner: repoOwner, name, full_name: `${repoOwner}/${name}`, owner_type: "Organization", language: "TypeScript", current_stars: 10000 + id, active: true, tracked_since: null };
    lookup[String(id)] = entry;
    entries.push({ id, node_id: `R_${id}`, owner: entry.owner, name, full_name: entry.full_name, stars: entry.current_stars });
    repos[repoBucket(id)]![String(id)] = { ...entry, id, node_id: `R_${id}`, d: 1, topics: [], created_at: "2025-01-01" };
    monthly[repoBucket(id)]![String(id)] = [["2025-12", 100], ...Array.from({ length: 8 }, (_, i) => [`2026-${String(i + 1).padStart(2, "0")}`, 10])];
    weekly[repoBucket(id)]![String(id)] = Array.from({ length: 7 }, (_, i) => [`2026-W${30 + i}`, 2]);
    daily[repoBucket(id)]![String(id)] = [["2026-09-27", 1]];
    pending[String(id)] = [["2026-09-07", 1], ["2026-09-14", 1], ["2026-09-21", 1], ["2026-09-27", 1]];
  }
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    for (const [family, shards] of [["repos", repos], ["repo-monthly", monthly], ["repo-weekly", weekly], ["repo-recent-daily", daily]] as const) {
      set(`canonical/v2/${family}/${bucket}.json`, shards[bucket]);
    }
  }
  const meta = { seam_date: "2025-12-31", schema_ver: 1, folded_through: { month: "2026-08", week: "2026-W36" }, generated_at: TEST_NOW };
  set("canonical/v2/meta.json", meta);
  set(`views/${PREVIOUS_RUN}/meta.json`, { ...meta, active_repo_count: repoCount, historical_repo_count: 0 });
  set(`views/${PREVIOUS_RUN}/lookup/repos.json`, lookup);
  set(`views/${PREVIOUS_RUN}/lookup/aliases.json`, {});
  set("canonical/v2/pending/2026-09.json", { period: "2026-09", frozen_at: TEST_NOW, per_repo: pending, daily_totals: [["2026-09-07", repoCount], ["2026-09-14", repoCount], ["2026-09-21", repoCount], ["2026-09-27", repoCount]] });
  set("canonical/v2/site-daily/2025.json", { year: "2025", cells: [["2025-12-31", 100000]] });
  set("views/latest.json", { version: PREVIOUS_RUN, run_id: PREVIOUS_RUN, published_at: "2025-01-01T00:00:00.000Z", prev_version: null, schema_ver: 1 });
  const snapshot = { generated_at: TEST_NOW, count: entries.length, entries, diff: { added: [], dropped: [] } };
  set(`canonical/v2/whitelist/${PREVIOUS_RUN}.json`, { ...snapshot, run_id: PREVIOUS_RUN });
  // Real whitelist reuse avoids Search; metadata's external GitHub port below
  // supplies fixed records. Every workflow handler remains the production one.
  set("canonical/v2/whitelist/discovery.json", { ...snapshot, run_id: "discovery" });
  set("ops/workflows/latest-unpublished-whitelist.json", { run_id: "discovery", count: entries.length, recorded_at: TEST_NOW });
  for (let i = 0; i < 5; i++) set(`views/refresh-2026-09-${20 + i}/orphan.json`, {});
  return seed;
}

export function installWorkflowHarness(
  initial = workflowSeed(),
  extraEnv: Record<string, string> = {},
  options: { now?: string } = {},
) {
  const store = new WorkflowTestStore(initial);
  // A distinct test-only callback origin exposes accidental site-URL fallbacks.
  const env = { BLOB_BASE_URL: "https://workflow.test.invalid", STORAGE_READ_DRIVER: "blob", HOSTING_TARGET: "cf", DEPLOY_ENV: "pre", CF_CRON_ORIGIN: "https://workflow-cron.test.invalid", WORKFLOW_RUNTIME: "memory", WORKFLOW_QUEUE_ENQUEUE_URL: "https://workflow.test.invalid/api/workflows/refresh/enqueue", CRON_SECRET: "workflow-test-only", NEXT_PUBLIC_SITE_URL: "https://workflow.test.invalid", WORKFLOW_STEP_BASE_URL: "https://workflow.test.invalid", WHITELIST_SEARCH_SHARDS: "0", ...extraEnv };
  const previousEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const now = options.now ?? TEST_NOW;
  setSystemTime(new Date(now));
  // Advance the rate-budget clock instead of waiting on real write throttles.
  let clock = Date.parse(now);
  const clockSpy = spyOn(Date, "now").mockImplementation(() => (clock += 20));
  const storeSpy = spyOn(storage, "getWriteObjectStore").mockReturnValue(store);
  const leaseCache = new WorkflowLeaseWriteCache();
  const lease = new BlobWorkflowLeaseStore(leaseCache, store);
  const leaseSpies = [
    spyOn(blobWorkflowLeaseStore, "read").mockImplementation(() => lease.read()),
    spyOn(blobWorkflowLeaseStore, "create").mockImplementation((value) => lease.create(value)),
    spyOn(blobWorkflowLeaseStore, "compareAndSet").mockImplementation((etag, value) => lease.compareAndSet(etag, value)),
  ];
  const metadataSpy = spyOn(github, "fetchRepositoryMetadata").mockImplementation(async (nodeIds) => {
    store.subrequests.use("fetchGithub");
    return new Map(nodeIds.map((nodeId) => {
      const id = Number(nodeId.slice(2));
      return [id, { owner: "example", owner_type: "Organization" as const, name: `repo-${id}`, full_name: `example/repo-${id}`, current_stars: 10000 + id, description: null, language: "TypeScript", languages: [], topics: [], created_at: "2025-01-01", is_archived: false }];
    }));
  });
  const originalFetch = globalThis.fetch;
  const invalidations: Array<{ url: string; init?: RequestInit }> = [];
  const indexNowSubmissions: IndexNowPayload[] = [];
  let invalidationStatus = 200;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === INDEXNOW_ENDPOINT && init?.method === "POST") {
      store.subrequests.use("fetchIndexNow");
      indexNowSubmissions.push(JSON.parse(String(init.body)) as IndexNowPayload);
      return new Response(null, { status: 200 });
    }
    if (url.pathname === "/api/workflows/refresh/revalidate") {
      store.subrequests.use("fetchInvalidation");
      invalidations.push({ url: url.href, init });
      return new Response(null, { status: invalidationStatus });
    }
    if (url.origin !== env.BLOB_BASE_URL || (init?.method && init.method !== "GET")) {
      throw new Error(`unexpected external request: ${url.origin}${url.pathname}`);
    }
    const path = decodeURIComponent(url.pathname.slice(1));
    store.reads.push(path);
    if (store.failRead) {
      store.failRead = false;
      return new Response("{", { status: 200 });
    }
    const object = await store.readPublic(path);
    return object ? new Response(object.body, { headers: { "content-type": "application/json", etag: object.etag! } }) : new Response(null, { status: 404 });
  }) as typeof fetch;
  clearViewParseMemo();
  invalidatePublishedVersionMemo();

  return {
    store,
    invalidations,
    indexNowSubmissions,
    setInvalidationStatus: (status: number) => { invalidationStatus = status; },
    async run(job: FullJob, options: Pick<RefreshStepRouteOptions, "executeFull" | "recordCheckpoint"> & { subrequestLimit?: number; queueConsumer?: boolean } = {}): Promise<{ response: Response; result?: RefreshStepResult }> {
      store.subrequests.reset(options.subrequestLimit);
      leaseCache.forget();
      clearViewParseMemo();
      invalidatePublishedVersionMemo();
      const { runRefreshStepRoute } = await import("./runtime/step-route");
      const response = await runRefreshStepRoute(new Request(`${env.BLOB_BASE_URL}/api/workflows/refresh/step`, { method: "POST", headers: { authorization: `Bearer ${env.CRON_SECRET}`, "content-type": "application/json", ...(options.queueConsumer ? { "x-gitstarclub-queue-advance": "consumer" } : {}) }, body: JSON.stringify(job) }), { kind: options.queueConsumer ? "cf-queue" : "memory", retry: { retries: 0, delaysMs: [] }, executeFull: options.executeFull, recordCheckpoint: options.recordCheckpoint });
      const body = await response.clone().json() as { result?: RefreshStepResult };
      return { response, result: body.result };
    },
    restore() {
      globalThis.fetch = originalFetch;
      storeSpy.mockRestore();
      for (const spy of leaseSpies) spy.mockRestore();
      metadataSpy.mockRestore();
      clockSpy.mockRestore();
      setSystemTime();
      for (const key of Object.keys(env)) {
        if (previousEnv[key] === undefined) delete process.env[key];
        else process.env[key] = previousEnv[key];
      }
      clearViewParseMemo();
      invalidatePublishedVersionMemo();
    },
  };
}

/** Drain only one logical step while preserving the real invocation boundaries. */
export async function drainWorkflowStep(harness: ReturnType<typeof installWorkflowHarness>, first: FullJob) {
  const { nextRefreshJob } = await import("./runtime/graph");
  let job: FullJob | null = first;
  for (let hop = 0; job && hop < 1000; hop++) {
    const output = await harness.run(job);
    if (!output.response.ok || !output.result) return output;
    const next = nextRefreshJob(job, output.result) as FullJob | null;
    if (!next || next.name !== first.name) return output;
    job = next;
  }
  throw new Error(`step ${first.name} did not finish`);
}
