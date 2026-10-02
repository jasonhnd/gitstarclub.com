// Invoked in a clean environment by ../r2-local-rehearsal.ts.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Miniflare } from "miniflare";
import type { R2Bucket } from "../../lib/storage/r2-binding-store";

const scratch = process.argv[2];
assert(scratch, "the wrapper must provide a private scratch directory");
const root = resolve(import.meta.dir, "../../..");
const pipeline = join(scratch, "pipeline");
const bucketName = "gitstarclub-local-rehearsal-pre";
const identityKey = "_meta/bucket-identity.json";
const pointerKey = "bootstrap/latest.json";
const activeKey = "ops/workflows/active.json";
const generation = "bootstrap-20260717T000000Z-local";
const otherGeneration = "bootstrap-20260717T000000Z-other";
// Fabricated local SigV4 values accepted only by this Miniflare instance.
const localKeys = { accessKeyId: "local-rehearsal-only", secretAccessKey: "not-a-cloud-credential" };
const identity = JSON.stringify({ bucket: bucketName, deploy_env: "pre" });
const readPaths: string[] = [];
let miniflare: Miniflare | undefined;
let bucket!: R2Bucket;
let base = "";

function passed(message: string): void {
  console.log(`PASS ${message}`);
}

async function run(command: string[], expectedError?: RegExp, env: Record<string, string> = {}): Promise<string> {
  const child = Bun.spawn(command, {
    cwd: pipeline,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: join(scratch, "home"),
      TMPDIR: join(scratch, "tmp"),
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill(), 30_000);
  try {
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const output = stdout + stderr;
    if (expectedError) {
      assert.notEqual(status, 0, `expected refusal: ${command.join(" ")}`);
      assert.match(output, expectedError);
    } else {
      assert.equal(status, 0, output);
    }
    return output;
  } finally {
    clearTimeout(timer);
  }
}

async function backfill(step: "06-upload" | "07-export-v2", flags: string[] = [], expectedError?: RegExp): Promise<string> {
  return run([
    "node", `backfill/${step}.mjs`, "--store", "r2", "--target", "pre",
    "--generation", generation, ...flags,
  ], expectedError, {
    R2_BUCKET_PRE: bucketName,
    R2_S3_ENDPOINT: `${base}/cdn-cgi/local/r2/s3`,
    R2_ACCESS_KEY_ID: localKeys.accessKeyId,
    R2_SECRET_ACCESS_KEY: localKeys.secretAccessKey,
  });
}

async function snapshot() {
  const listed = await bucket.list();
  assert.equal(listed.truncated, false, "fixture must fit in one bucket listing");
  return Promise.all(listed.objects.map(async (object) => {
    const body = await bucket.get(object.key);
    assert(body);
    return {
      key: object.key,
      etag: object.etag,
      sha256: createHash("sha256").update(new Uint8Array(await body.arrayBuffer())).digest("hex"),
    };
  }));
}

async function json(key: string) {
  const value = await bucket.get(key);
  assert(value, `missing ${key}`);
  return JSON.parse(await value.text());
}

async function worker(path: string, input: Record<string, unknown> = {}, expectedError?: RegExp) {
  assert(miniflare);
  const response = await miniflare.dispatchFetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = await response.json() as Record<string, unknown>;
  if (expectedError) {
    assert.equal(response.status, 409, JSON.stringify(result));
    assert.match(String(result.error), expectedError);
  } else {
    assert.equal(response.status, 200, JSON.stringify(result));
  }
  return result;
}

async function start(contents: string): Promise<void> {
  miniflare = new Miniflare({
    host: "127.0.0.1",
    port: 0,
    cf: {},
    telemetry: { enabled: false },
    resourcePersistencePath: join(scratch, "state"),
    workers: [{
      config: {
        name: "r2-local-rehearsal",
        type: "worker",
        compatibilityDate: "2026-09-01",
        compatibilityFlags: ["nodejs_compat"],
        manifest: {
          mainModule: "worker.js",
          modules: {
            "worker.js": { type: "esm", contents },
            // The standalone Worker has no Next request cache. Fail loudly if
            // it is called; production data/driver/lease modules are unchanged.
            "next/cache": { type: "esm", contents: "throw new Error('Next cache is unavailable in the standalone rehearsal');" },
          },
        },
        env: {
          DATA: { type: "r2", name: bucketName, dev: { remote: false, experimentalS3Credentials: localKeys } },
          STORAGE_READ_DRIVER: { type: "text", value: "r2" },
          STORAGE_WRITE_DRIVER: { type: "text", value: "r2_binding" },
          DEPLOY_ENV: { type: "text", value: "pre" },
          R2_BUCKET: { type: "text", value: bucketName },
          // Public reads loop back through the same workerd DATA bucket.
          R2_PUBLIC_BASE_URL: { type: "text", value: `http://127.0.0.1/cdn-cgi/local/r2/public/${bucketName}` },
          HOSTING_TARGET: { type: "text", value: "cf" },
        },
      },
      dev: {
        unsafeRegisterWorker: false,
        outboundService: {
          type: "fetcher",
          handler: async (request, local) => {
            const url = new URL(request.url);
            assert.equal(url.origin, "http://127.0.0.1", "refusing nonlocal Worker egress");
            assert.equal(request.method, "GET", "public fixture reads are GET only");
            assert(url.pathname.startsWith(`/cdn-cgi/local/r2/public/${bucketName}/`));
            readPaths.push(url.pathname);
            return local.dispatchFetch(request.url, { method: request.method, headers: request.headers });
          },
        },
      },
    }],
  });
  base = (await miniflare.ready).origin;
  bucket = await miniflare.getR2Bucket("DATA") as unknown as R2Bucket;
}

async function stop(): Promise<void> {
  await miniflare?.dispose();
  miniflare = undefined;
}

async function fixture(): Promise<void> {
  await mkdir(join(pipeline, "backfill"), { recursive: true });
  await mkdir(join(pipeline, "lib"));
  await mkdir(join(pipeline, "data"));
  for (const step of ["06-upload.mjs", "07-export-v2.mjs"]) {
    await cp(join(root, "pipeline/backfill", step), join(pipeline, "backfill", step));
  }
  for (const file of await readdir(join(root, "pipeline/lib"))) {
    if (file.endsWith(".mjs")) await cp(join(root, "pipeline/lib", file), join(pipeline, "lib", file));
  }
  await symlink(join(root, "pipeline/node_modules"), join(pipeline, "node_modules"), "dir");
  await symlink(join(root, "web"), join(scratch, "web"), "dir");
  await cp(join(root, "web/scripts/fixtures/views"), join(pipeline, "data/views"), { recursive: true });
  const repos = JSON.parse(await readFile(join(pipeline, "data/views/lookup/repos.json"), "utf8"));
  await writeFile(join(pipeline, "data/repos.json"), JSON.stringify([{
    id: 1, node_id: "local-repo-1", created_at: "2026-07-01T00:00:00.000Z", ...repos["1"],
  }]));
  await writeFile(join(pipeline, "fixture.mjs"), `
import { DuckDBInstance } from '@duckdb/node-api';
const db = await DuckDBInstance.create();
const con = await db.connect();
await con.run("COPY (SELECT 1::BIGINT repo_id, DATE '2026-07-17' date, 100::BIGINT delta) TO 'data/star_daily.parquet' (FORMAT PARQUET)");
con.closeSync();
db.closeSync();
`);
  await run(["node", "fixture.mjs"]);
}

try {
  await fixture();
  const built = await Bun.build({
    entrypoints: [join(import.meta.dir, "r2-local-rehearsal-worker.ts")],
    target: "browser",
    external: ["node:*", "next/cache"],
    define: { "process.env.NEXT_RUNTIME": JSON.stringify("local-rehearsal") },
    minify: { syntax: true, whitespace: false, identifiers: false },
  });
  assert.equal(built.success, true, String(built.logs));
  const contents = await built.outputs[0].text();
  await start(contents);
  await bucket.put(identityKey, JSON.stringify({ bucket: bucketName, deploy_env: "production" }));
  const wrongIdentity = await snapshot();
  await backfill("06-upload", [], /identity deploy_env=production/);
  await backfill("06-upload", ["--execute"], /identity deploy_env=production/);
  await worker("/guard", {}, /identity deploy_env=production/);
  assert.deepEqual(await snapshot(), wrongIdentity);
  passed("pre-target pipeline dry run/execute and Worker refuse a production identity; no bucket mutations");
  await bucket.put(identityKey, identity);
  const empty = await snapshot();
  assert.match(await backfill("06-upload"), /nothing uploaded/);
  assert.match(await backfill("07-export-v2"), /no remote writes/);
  assert.deepEqual(await snapshot(), empty);
  passed("06/07 dry runs: real local S3 identity reads, zero bucket mutations");

  await backfill("06-upload", ["--execute"]);
  assert.equal(await bucket.head(pointerKey), null);
  await backfill("07-export-v2", ["--execute", "--stage-only"]);
  assert.equal(await bucket.head(pointerKey), null);
  assert.equal(await bucket.head("views/latest.json"), null);
  passed("06 upload and 07 stage-only: sealed fixtures, no published pointers");

  const at = new Date().toISOString();
  const claimed = await worker("/claim", { runId: "local-workflow", at });
  assert.equal(claimed.status, "acquired");
  const lease = claimed.lease as { fencing_token: number; expires_at: string };
  const beforeRenewal = await bucket.head(activeKey);
  const renewed = await worker("/renew", {
    runId: "local-workflow", fencingToken: lease.fencing_token,
    at: new Date(Date.parse(at) + 5000).toISOString(),
  });
  assert.notEqual((await bucket.head(activeKey))?.etag, beforeRenewal?.etag);
  assert(Date.parse(String(renewed.expires_at)) > Date.parse(lease.expires_at));
  const refusedClaim = await worker("/claim", { runId: "other-workflow", at });
  assert.equal(refusedClaim.status, "rejected");
  const locked = await snapshot();
  await backfill("07-export-v2", ["--execute", "--initial-commit"], /blocked by active workflow local-workflow/);
  await worker("/initial", { generation }, /blocked by active workflow local-workflow/);
  assert.deepEqual(await snapshot(), locked);
  const release = await worker("/release", {
    runId: "local-workflow", fencingToken: lease.fencing_token,
    at: new Date(Date.parse(at) + 10000).toISOString(),
  });
  assert.equal(release, true);
  assert.equal((await json(activeKey)).status, "published");
  passed("Worker DATA lease claim/renew/release; competing workflow and both initial commits refused");

  await backfill("07-export-v2", ["--execute", "--initial-commit"]);
  const pointer = await json(pointerKey);
  assert.equal(pointer.generation, generation);
  assert.equal(pointer.previous_generation, null);
  assert.equal((await json(activeKey)).status, "published");
  assert.equal(await bucket.head("views/latest.json"), null);
  assert.match(await backfill("07-export-v2", ["--execute", "--initial-commit"]), /already-published/);
  passed("pipeline initial commit and retry: previous_generation null, shared lease released");

  const durable = await snapshot();
  await stop();
  await start(contents);
  assert.deepEqual(await snapshot(), durable);
  const rank = await worker("/rank");
  assert.deepEqual(rank.drivers, { read: "r2", write: "r2_binding" });
  assert.equal(rank.managedPointer, null);
  assert.equal(rank.resolvedPath, `bootstrap/generations/${generation}/views/rank/month/2026-07/repo/flow.json`);
  assert.deepEqual(rank.rank, JSON.parse(await readFile(join(pipeline, "data/views/rank/month/2026-07/repo/flow.json"), "utf8")));
  assert(readPaths.some((path) => path.endsWith(String(rank.resolvedPath))));
  passed("persistent restart; Worker rankings read through R2 public origin from DATA bootstrap generation");

  const head = await bucket.head(pointerKey);
  assert(head);
  const cas = await worker("/cas", {
    etag: head.httpEtag,
    body: JSON.stringify({ ...pointer, published_at: "2026-10-01T00:00:00.000Z" }),
  });
  assert.notEqual(cas.etag, head.httpEtag);
  assert(miniflare);
  const stale = await miniflare.dispatchFetch(`${base}/cas`, {
    method: "POST", body: JSON.stringify({ etag: head.httpEtag, body: JSON.stringify(pointer) }),
  });
  assert.equal(stale.status, 412, await stale.text());
  assert.equal((await bucket.head(pointerKey))?.httpEtag, cas.etag);
  passed("Worker pointer CAS: current quoted HTTP ETag succeeds; stale ETag gets 412 without overwrite");

  await backfill("06-upload", ["--execute", "--generation", otherGeneration]);
  await backfill("07-export-v2", ["--execute", "--stage-only", "--generation", otherGeneration]);
  const currentPointer = await bucket.get(pointerKey);
  assert(currentPointer);
  const currentBytes = await currentPointer.text();
  await backfill("07-export-v2", ["--execute", "--initial-commit", "--generation", otherGeneration], /bootstrap\/latest.json already exists/);
  await worker("/initial", { generation: otherGeneration }, /bootstrap\/latest.json already exists/);
  assert.equal(await (await bucket.get(pointerKey))?.text(), currentBytes);
  passed("pipeline and Worker initial commit refuse a different existing pointer");

  // Delete only this rehearsal's local fixture pointer to probe the empty-bucket
  // path. Neither the entrypoint nor these bucket handles can address a real R2.
  await bucket.delete(pointerKey);
  await bucket.put("views/latest.json", "{}");
  await worker("/initial", { generation }, /views\/latest.json already exists/);
  assert.equal(await bucket.head(pointerKey), null);
  await bucket.delete("views/latest.json");
  await bucket.put("canonical/v2/meta.json", "{}");
  await worker("/initial", { generation }, /canonical\/v2\/meta.json already exists/);
  assert.equal(await bucket.head(pointerKey), null);
  await bucket.delete("canonical/v2/meta.json");
  await worker("/initial", { generation, race: true }, /views\/latest.json already exists/);
  assert.equal(await bucket.head(pointerKey), null);
  await bucket.delete("views/latest.json");
  const initial = await worker("/initial", { generation });
  assert.equal(initial.status, "published");
  assert.equal((await json(pointerKey)).previous_generation, null);
  assert.equal((await json(activeKey)).status, "published");
  passed("Worker initial commit: mixed state and renewal race refused; empty bucket publishes with byte-preserving DATA reads");

  assert.equal(await (await bucket.get(identityKey))?.text(), identity);
  console.log("R2_LOCAL_REHEARSAL_OK");
} finally {
  await stop();
}
