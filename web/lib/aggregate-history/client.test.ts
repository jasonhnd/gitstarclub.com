import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { AggregateHistoryWorkerClient, aggregateWorkerOrigin } from "../../scripts/lib/aggregate-history-worker-client";
import { importAggregateHistory } from "../../scripts/lib/aggregate-history-import";
import { inspectPreviewAggregate } from "../../scripts/inspect-preview-aggregate";
import { verifyPreviewAggregate } from "../../scripts/verify-preview-aggregate";
import { main, parseAggregateImportArgs } from "../../scripts/import-star-history-aggregate";
import type { AggregateBundle } from "../../scripts/lib/aggregate-history-input";
import * as aggregateInput from "../../scripts/lib/aggregate-history-input";
import { buildBootstrapPhaseManifest } from "../../../pipeline/lib/bootstrap-publication.mjs";
import { importDigest } from "./protocol";
import { GAP_DAYS, gapSeries } from "../../../pipeline/scripts/star-history-aggregate.mjs";
import { lookupRepoEntry, orgEntityFromParts, repoEntityFromParts } from "../workflows/recompute/entities";
import { AGGREGATE_MANIFEST_SHA256 } from "./policy";
import { importWorkerHarness } from "./test-support";

const GEN = "bootstrap-aggregate-worker-test";
const NOW = "2026-10-22T00:00:00.000Z";
const ORIGIN = "https://pre.gitstarclub.com";
const SECRET = "aggregate-test-secret";
const encode = (value: unknown) => JSON.stringify(value);

function fixture(repoCount = 1, sourceCount = repoCount, owners = 1) {
  const initial: Record<string, string> = {};
  const set = (path: string, value: unknown) => { initial[path] = encode(value); };
  const raw = Array.from({ length: 32 }, () => ({ repos: {}, daily: {}, weekly: {}, monthly: {} } as Record<string, Record<string, unknown>>));
  const lookup: Record<string, unknown> = {};
  const groups = new Map<string, number[]>();
  const series = GAP_DAYS.map((day: string) => [day, 2] as [string, number]);
  const weekly = gapSeries({ status: "complete", daily: Object.fromEntries(series) }).weekly.map((row): [string, number] => [String(row[0]), Number(row[1])]);
  const bundle: AggregateBundle = { sha256: AGGREGATE_MANIFEST_SHA256, daily: {}, weekly: {}, missing: [] };
  for (let id = 1; id <= repoCount; id++) {
    const owner = `owner${id % owners}`;
    const repo = { id, node_id: `R_${id}`, owner, owner_type: "Organization" as const, name: id === 1 ? "react" : `repo${id}`, full_name: `${owner}/${id === 1 ? "react" : `repo${id}`}`, current_stars: 10000 + id, created_at: "2020-01-01", d: 2, active: true, tracked_since: null };
    const bucket = raw[id % 32]!;
    bucket.repos![String(id)] = repo;
    bucket.daily![String(id)] = [["2026-10-21", 3]];
    bucket.weekly![String(id)] = [["2026-W43", 3]];
    lookup[String(id)] = lookupRepoEntry(repo);
    set(`views/refresh-fixture/entity/repo/${id}.json`, repoEntityFromParts(repo, [], [["2026-10-21", 3]]).entity);
    const group = groups.get(owner) ?? []; group.push(id); groups.set(owner, group);
    if (id <= sourceCount) { bundle.daily[String(id)] = series; bundle.weekly[String(id)] = weekly; }
  }
  for (const [owner, members] of groups) set(`views/refresh-fixture/entity/org/${owner}.json`, orgEntityFromParts(owner, "Organization", members.reduce((sum, id) => sum + 10000 + id, 0), members.length, members, [], [["2026-10-21", members.length * 3]]).entity);
  const meta = { schema_ver: 1, seam_date: "2026-05-30", generated_at: NOW, folded_through: { month: "2026-09", week: "2026-W39" } };
  set("canonical/v2/meta.json", meta);
  set("views/refresh-fixture/meta.json", { ...meta, active_repo_count: repoCount, historical_repo_count: 0 });
  set("views/refresh-fixture/lookup/repos.json", lookup);
  set("views/latest.json", { schema_ver: 1, version: "refresh-fixture", run_id: "refresh-fixture", published_at: NOW, prev_version: null });
  set("views/refresh-fixture/rank/month/2026-05/repo/flow.json", { preserved: "monthly bytes" });
  for (let bucket = 0; bucket < 32; bucket++) for (const [family, key] of [["repos", "repos"], ["repo-recent-daily", "daily"], ["repo-weekly", "weekly"], ["repo-monthly", "monthly"]]) set(`canonical/v2/${family}/${bucket}.json`, raw[bucket]![key!]);
  return { initial, bundle };
}

const scratch: string[] = [];
afterEach(() => { for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true }); });
function checkpoint() { const dir = mkdtempSync(join(tmpdir(), "aggregate-worker-")); scratch.push(dir); return join(dir, "checkpoint.json"); }
function client(h: ReturnType<typeof importWorkerHarness>, path: string, fetchImpl = h.fetchImpl) {
  return new AggregateHistoryWorkerClient({ origin: ORIGIN, generation: GEN, secret: SECRET, checkpoint: path, fetchImpl });
}

type RunbookCase = { execute: boolean; secretFirst: boolean };
const runbookCases: RunbookCase[] = [
  { execute: false, secretFirst: false }, { execute: false, secretFirst: true },
  { execute: true, secretFirst: true }, { execute: true, secretFirst: false },
];
function runbookArgs(options: RunbookCase, secretFile: string, localCheckpoint: string): string[] {
  const base = ["--target", "pre", "--source", "private-local", "--generation", GEN];
  const worker = ["--worker-url", ORIGIN];
  const secret = ["--secret-file", secretFile];
  if (!options.execute) return [...base, ...(options.secretFirst ? [...secret, ...worker] : [...worker, ...secret])];
  const execution = ["--checkpoint", localCheckpoint, "--execute"];
  return [...base, ...worker, ...(options.secretFirst ? [...secret, ...execution] : [...execution, ...secret])];
}

describe("operator Worker transport", () => {
  test.each(runbookCases)("file-only runbook arguments preserve independent options: %j", (options) => {
    const args = runbookArgs(options, "fixture-secret", "fixture-checkpoint.json");
    expect(parseAggregateImportArgs(args)).toEqual({ source: "private-local", generation: GEN, workerUrl: ORIGIN, secretFile: "fixture-secret", execute: options.execute, ...(options.execute ? { checkpoint: "fixture-checkpoint.json" } : {}) });
  });

  test("a secret file cannot substitute for a required execution checkpoint", () => {
    const args = [...runbookArgs({ execute: false, secretFirst: false }, "fixture-secret", "unused"), "--execute"];
    expect(() => parseAggregateImportArgs(args)).toThrow("--checkpoint is required");
    expect(() => parseAggregateImportArgs(["--target", "pre", "--source", "private-local", "--generation", GEN, "--secret-file", "fixture-secret"])).toThrow("--secret-file requires --worker-url");
  });

  test.each(runbookCases)("file-only runbook CLI authenticates without ambient CRON_SECRET: %j", async (options) => {
    const { initial, bundle } = fixture(); const h = importWorkerHarness(initial);
    const localCheckpoint = checkpoint(); const secretFile = join(dirname(localCheckpoint), "fixture-secret");
    writeFileSync(secretFile, `${SECRET}\n`, { mode: 0o600 });
    const previousSecret = process.env.CRON_SECRET;
    const previousFetch = globalThis.fetch;
    const source = spyOn(aggregateInput, "loadAggregateBundle").mockReturnValue(bundle);
    const output = spyOn(console, "log").mockImplementation(() => {});
    try {
      delete process.env.CRON_SECRET;
      globalThis.fetch = h.fetchImpl;
      await main(runbookArgs(options, secretFile, localCheckpoint));
      expect(source).toHaveBeenCalledWith(resolve("private-local"));
      expect(output).toHaveBeenCalledTimes(1);
      const text = String(output.mock.calls[0]![0]);
      expect(text).not.toContain(SECRET);
      expect(JSON.parse(text).status).toBe(options.execute ? "published" : "dry-run");
      if (options.execute) {
        expect(JSON.parse(readFileSync(localCheckpoint, "utf8"))).toMatchObject({ generation: GEN, status: "published" });
        expect(await h.bucket.store.get("bootstrap/latest.json")).not.toBeNull();
      } else expect(h.bucket.writes).toHaveLength(0);
    } finally {
      source.mockRestore(); output.mockRestore(); globalThis.fetch = previousFetch;
      if (previousSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousSecret;
    }
  });

  test("CLI and client refuse production/redirectable origins and missing execution checkpoints", async () => {
    for (const value of ["https://gitstarclub.com", "https://pre.gitstarclub.com/other", "https://pre.gitstarclub.com?x=1", "https://user@pre.gitstarclub.com"]) expect(() => aggregateWorkerOrigin(value)).toThrow("preview Worker origin");
    const args = ["--target", "pre", "--source", "private-local", "--generation", GEN, "--worker-url", ORIGIN];
    expect(parseAggregateImportArgs(args).workerUrl).toBe(ORIGIN);
    expect(() => parseAggregateImportArgs([...args, "--execute"])).toThrow("checkpoint");
    expect(parseAggregateImportArgs([...args, "--execute", "--checkpoint", "local.json"]).execute).toBe(true);
    expect(() => parseAggregateImportArgs(["--target", "pre", "--source", "x", "--generation", GEN, "--checkpoint", "x"])).toThrow("requires --worker-url");
    const h = importWorkerHarness(); const c = client(h, checkpoint());
    await expect(c.store.put("bootstrap/latest.json", "{}")).rejects.toThrow("direct writes");
    await expect(c.store.del("canonical/v2/meta.json")).rejects.toThrow("deletes");
    expect(h.bucket.writes).toHaveLength(0);
  });

  test("dry-run is read-only; publish retries lost stage/verify/commit/release responses and is idempotent", async () => {
    const { initial, bundle } = fixture(); const h = importWorkerHarness(initial); const path = checkpoint();
    const dropped = new Set<string>();
    const lossy = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const response = await h.fetchImpl(url, init);
      if (["begin", "stage", "verify", "commit", "release"].includes(body.action) && !dropped.has(body.action) && response.ok) { dropped.add(body.action); throw new Error("response lost after commit"); }
      return response;
    }) as typeof fetch;
    const c = client(h, path, lossy);
    expect((await importAggregateHistory({ store: c.store, publisher: c, generation: GEN, bundle, execute: false })).status).toBe("dry-run");
    expect(h.bucket.writes).toHaveLength(0);
    expect((await importAggregateHistory({ store: c.store, publisher: c, generation: GEN, bundle, execute: true })).status).toBe("published");
    expect(dropped.size).toBe(5);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ token: 1, status: "published" });
    const retry = client(h, path);
    expect((await importAggregateHistory({ store: retry.store, publisher: retry, generation: GEN, bundle, execute: true })).status).toBe("already-published");
    const pointer = JSON.parse((await h.bucket.store.get("bootstrap/latest.json"))!.body);
    expect(pointer.previous_generation).toStartWith("bootstrap-aggregate-recovery-");
    expect((await h.bucket.store.get(`bootstrap/generations/${GEN}/views/rank/month/2026-05/repo/flow.json`))!.body).toBe(initial["views/refresh-fixture/rank/month/2026-05/repo/flow.json"]);
    expect(h.bucket.writes.every((w) => w.onlyIf?.etagDoesNotMatch === "*" || !!w.onlyIf?.etagMatches)).toBe(true);
    expect(h.calls.commit).toBeLessThan(64);
  });

  test("a fresh process resumes an active same-generation session, but a foreign checkpoint is rejected", async () => {
    const { initial, bundle } = fixture(); const h = importWorkerHarness(initial); const path = checkpoint();
    const begun = await h.request({ action: "begin" }); const session = await begun.json() as { token: number };
    // Simulate process loss after begin: no release and no in-memory client state.
    writeFileSync(path, encode({ generation: GEN, sourceSha256: AGGREGATE_MANIFEST_SHA256, origin: ORIGIN, token: session.token, status: "running" }));
    const c = client(h, path);
    expect((await importAggregateHistory({ store: c.store, publisher: c, generation: GEN, bundle, execute: true })).status).toBe("published");
    expect(JSON.parse(readFileSync(path, "utf8")).token).toBe(session.token);
    const other = checkpoint(); writeFileSync(other, encode({ generation: "bootstrap-aggregate-other", sourceSha256: AGGREGATE_MANIFEST_SHA256, origin: ORIGIN }));
    await expect(client(h, other).withLease(async () => ({ status: "unused" }))).rejects.toThrow("different import");
  });

  test("unexpired foreign lease refuses; publication movement and takeover during stage leave pointer unchanged", async () => {
    for (const mode of ["active", "takeover", "pointer"] as const) {
      const { initial, bundle } = fixture(); const h = importWorkerHarness(initial); const c = client(h, checkpoint());
      if (mode === "active") await h.bucket.store.put("ops/workflows/active.json", encode({ run_id: "refresh-other", status: "running", fencing_token: 4, expires_at: "2099-01-01T00:00:00Z" }));
      else {
        let injected = false;
        h.bucket.beforePut = async (path) => {
          if (injected || !path.startsWith("bootstrap/generations/")) return;
          injected = true;
          if (mode === "takeover") await h.bucket.store.put("ops/workflows/active.json", encode({ run_id: "successor", status: "running", fencing_token: 99, expires_at: "2099-01-01T00:00:00Z" }));
          else await h.bucket.store.put("views/latest.json", encode({ changed: true }));
        };
      }
      await expect(importAggregateHistory({ store: c.store, publisher: c, generation: GEN, bundle, execute: true })).rejects.toThrow();
      expect(await h.bucket.store.get("bootstrap/latest.json")).toBeNull();
      if (mode === "takeover") expect(JSON.parse((await h.bucket.store.get("ops/workflows/active.json"))!.body).run_id).toBe("successor");
    }
  });

  test("an existing bootstrap uses a conditional replacement and a raced first pointer is never overwritten", async () => {
    for (const existing of [false, true]) {
      const { initial, bundle } = fixture();
      if (existing) {
        const prior = "bootstrap-prior-fixture";
        const digests: Record<string, string> = {};
        for (const phase of ["base", "canonical"] as const) {
          const objects = Object.entries(initial).filter(([path]) => path.startsWith(phase === "base" ? "views/refresh-fixture/" : "canonical/v2/")).map(([path, body]) => ({ path: phase === "base" ? `views/${path.slice("views/refresh-fixture/".length)}` : path, body: Buffer.from(body) }));
          for (const item of objects) initial[`bootstrap/generations/${prior}/${item.path}`] = item.body.toString();
          const body = encode(buildBootstrapPhaseManifest(prior, phase, objects));
          initial[`bootstrap/generations/${prior}/manifests/${phase}.json`] = body;
          digests[phase] = importDigest(body);
        }
        initial["bootstrap/latest.json"] = encode({ schema_ver: 1, generation: prior, prefix: `bootstrap/generations/${prior}`, previous_generation: null, published_at: "2026-10-22T00:01:00.000Z", base_manifest_sha256: digests.base, canonical_manifest_sha256: digests.canonical });
      }
      const h = importWorkerHarness(initial); const c = client(h, checkpoint());
      if (existing) {
        expect((await importAggregateHistory({ store: c.store, publisher: c, generation: GEN, bundle, execute: true })).status).toBe("published");
        const write = h.bucket.writes.find((item) => item.path === "bootstrap/latest.json")!;
        expect(write.onlyIf!.etagMatches).toBeTruthy();
        expect(JSON.parse((await h.bucket.store.get("bootstrap/latest.json"))!.body).previous_generation).toBe("bootstrap-prior-fixture");
      } else {
        h.bucket.beforePut = async (path) => { if (path === "bootstrap/latest.json") await h.bucket.store.put(path, encode({ successor: "preserve this race winner" })); };
        await expect(importAggregateHistory({ store: c.store, publisher: c, generation: GEN, bundle, execute: true })).rejects.toThrow();
        expect(JSON.parse((await h.bucket.store.get("bootstrap/latest.json"))!.body).successor).toBe("preserve this race winner");
      }
    }
  });

  test("operator inspection and verification are read-only and detect changed daily history", async () => {
    const { initial, bundle } = fixture(3); const h = importWorkerHarness(initial); const c = client(h, checkpoint());
    expect((await inspectPreviewAggregate("unused", GEN, c)).active).toBe(false);
    await importAggregateHistory({ store: c.store, publisher: c, generation: GEN, bundle, execute: true });
    const writes = h.bucket.writes.length;
    const pages: string[] = [];
    const fetchImpl = (async (url: RequestInfo | URL) => {
      pages.push(String(url));
      const locale = String(url).includes("/ja/") ? "ja" : "en";
      return new Response(`<html lang="${locale}"><meta name="robots" content="noindex,nofollow">`, { status: 200 });
    }) as typeof fetch;
    const verified = await verifyPreviewAggregate("unused", "unused", GEN, { client: c, bundle, fetchImpl });
    expect(verified.samples).toHaveLength(3);
    expect(pages).toHaveLength(6);
    expect(h.bucket.writes.length).toBe(writes);
    expect((await inspectPreviewAggregate("unused", GEN, c)).lease.status).toBe("published");
    const path = `bootstrap/generations/${GEN}/views/entity/repo/1.json`;
    const entity = JSON.parse((await h.bucket.store.get(path))!.body);
    entity.curve.recent_daily[0][1]++;
    await h.bucket.store.put(path, encode(entity));
    await expect(verifyPreviewAggregate("unused", "unused", GEN, { client: c, bundle, fetchImpl })).rejects.toThrow();
  });

  test("5,669 repositories: full repair, recovery, staging, verification and commit stay within every invocation budget", async () => {
    const { initial, bundle } = fixture(5669, 5238, 5000);
    for (let id = 6000; id < 6005; id++) { bundle.daily[String(id)] = bundle.daily["1"]!; bundle.weekly[String(id)] = bundle.weekly["1"]!; }
    const h = importWorkerHarness(initial); const c = client(h, checkpoint());
    const result = await importAggregateHistory({ store: c.store, publisher: c, generation: GEN, bundle, execute: true });
    expect(result.status).toBe("published");
    expect(result.report!.counts).toMatchObject({ repositories_imported: 5238, daily_added: 649512, weekly_added: 89046, edge_weeks_skipped: 10476 });
    expect(result.report!.skipped.filter((item) => item.reason === "outside_fixed_source_whitelist")).toHaveLength(431);
    expect(result.report!.skipped.filter((item) => item.reason === "not_in_preview_membership")).toHaveLength(5);
    expect(h.maximum()).toBeLessThan(128);
    expect(h.calls.stage).toBeLessThan(100);
    expect(h.calls.verify).toBeLessThan(64);
    expect(h.calls.commit).toBeLessThan(64);
    console.log("aggregate import 5669-repository physical subrequest maxima", h.calls);
    expect(h.bucket.writes.filter((w) => w.path === "bootstrap/latest.json")).toHaveLength(1);
  }, 120000);
});
