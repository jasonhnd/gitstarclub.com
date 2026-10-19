import { setSystemTime, spyOn } from "bun:test";
import * as github from "@/lib/github";
import * as storage from "@/lib/storage";
import { MemoryObjectStore, type ObjectPutOptions } from "@/lib/storage";
import { clearViewParseMemo } from "@/lib/data/parse-view";
import { invalidatePublishedVersionMemo } from "@/lib/data/source";
import { REPO_BUCKETS, repoBucket } from "./buckets";
import { BlobWorkflowLeaseStore, WorkflowLeaseWriteCache, blobWorkflowLeaseStore } from "./lease";
import type { RefreshStepJob, RefreshStepResult } from "./runtime/types";

export const TEST_RUN = "refresh-2026-10-02-test";
export const PREVIOUS_RUN = "refresh-2025-01-01-test";
export const TEST_NOW = "2026-10-02T00:00:00.000Z";
export type FullJob = Extract<RefreshStepJob, { graph: "full" }>;

/** Track the real object-store port, including CAS and physical deletions. */
export class WorkflowTestStore extends MemoryObjectStore {
  readonly contents: Record<string, string>;
  readonly reads: string[] = [];
  readonly writes: string[] = [];
  readonly deletions: string[] = [];
  failWrite?: (path: string) => boolean;
  failRead = false;
  failDelete = false;

  constructor(initial: Record<string, string> = {}) {
    super(initial);
    this.contents = { ...initial };
  }

  override async put(path: string, body: string | Uint8Array, options?: ObjectPutOptions) {
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

  json<T = Record<string, unknown>>(path: string): T {
    const body = this.contents[path];
    if (body === undefined) throw new Error(`missing test artifact: ${path}`);
    return JSON.parse(body) as T;
  }

  async set(path: string, value: unknown) {
    await this.put(path, JSON.stringify(value));
  }
}

export function workflowSeed(): Record<string, string> {
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
  for (let id = 1; id <= 1000; id++) {
    const name = `repo-${id}`;
    const entry = { owner: "example", name, full_name: `example/${name}`, owner_type: "Organization", language: "TypeScript", current_stars: 10000 + id, active: true, tracked_since: null };
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
  set(`views/${PREVIOUS_RUN}/meta.json`, { ...meta, active_repo_count: 1000, historical_repo_count: 0 });
  set(`views/${PREVIOUS_RUN}/lookup/repos.json`, lookup);
  set(`views/${PREVIOUS_RUN}/lookup/aliases.json`, {});
  set("canonical/v2/pending/2026-09.json", { period: "2026-09", frozen_at: TEST_NOW, per_repo: pending, daily_totals: [["2026-09-07", 1000], ["2026-09-14", 1000], ["2026-09-21", 1000], ["2026-09-27", 1000]] });
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

export function installWorkflowHarness(initial = workflowSeed(), extraEnv: Record<string, string> = {}) {
  const store = new WorkflowTestStore(initial);
  // A distinct test-only callback origin exposes accidental site-URL fallbacks.
  const env = { BLOB_BASE_URL: "https://workflow.test.invalid", STORAGE_READ_DRIVER: "blob", HOSTING_TARGET: "cf", DEPLOY_ENV: "pre", CF_CRON_ORIGIN: "https://workflow-cron.test.invalid", WORKFLOW_RUNTIME: "memory", CRON_SECRET: "workflow-test-only", NEXT_PUBLIC_SITE_URL: "https://workflow.test.invalid", WORKFLOW_STEP_BASE_URL: "https://workflow.test.invalid", WHITELIST_SEARCH_SHARDS: "0", ...extraEnv };
  const previousEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  setSystemTime(new Date(TEST_NOW));
  // Advance the rate-budget clock instead of waiting on real write throttles.
  let clock = Date.parse(TEST_NOW);
  const clockSpy = spyOn(Date, "now").mockImplementation(() => (clock += 20));
  const storeSpy = spyOn(storage, "getWriteObjectStore").mockReturnValue(store);
  const lease = new BlobWorkflowLeaseStore(new WorkflowLeaseWriteCache(), store);
  const leaseSpies = [
    spyOn(blobWorkflowLeaseStore, "read").mockImplementation(() => lease.read()),
    spyOn(blobWorkflowLeaseStore, "create").mockImplementation((value) => lease.create(value)),
    spyOn(blobWorkflowLeaseStore, "compareAndSet").mockImplementation((etag, value) => lease.compareAndSet(etag, value)),
  ];
  const metadataSpy = spyOn(github, "fetchRepositoryMetadata").mockImplementation(async (nodeIds) => new Map(nodeIds.map((nodeId) => {
    const id = Number(nodeId.slice(2));
    return [id, { owner: "example", owner_type: "Organization" as const, name: `repo-${id}`, full_name: `example/repo-${id}`, current_stars: 10000 + id, description: null, language: "TypeScript", languages: [], topics: [], created_at: "2025-01-01", is_archived: false }];
  })));
  const originalFetch = globalThis.fetch;
  const invalidations: Array<{ url: string; init?: RequestInit }> = [];
  let invalidationStatus = 200;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/api/workflows/refresh/revalidate") {
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
    const object = await store.get(path);
    return object ? new Response(object.body, { headers: { "content-type": "application/json", etag: object.etag! } }) : new Response(null, { status: 404 });
  }) as typeof fetch;
  clearViewParseMemo();
  invalidatePublishedVersionMemo();

  return {
    store,
    invalidations,
    setInvalidationStatus: (status: number) => { invalidationStatus = status; },
    async run(job: FullJob): Promise<{ response: Response; result?: RefreshStepResult }> {
      const { runRefreshStepRoute } = await import("./runtime/step-route");
      const response = await runRefreshStepRoute(new Request(`${env.BLOB_BASE_URL}/api/workflows/refresh/step`, { method: "POST", headers: { authorization: `Bearer ${env.CRON_SECRET}`, "content-type": "application/json" }, body: JSON.stringify(job) }), { kind: "memory", retry: { retries: 0, delaysMs: [] } });
      const body = await response.json() as { result?: RefreshStepResult };
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
