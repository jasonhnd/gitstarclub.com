import assert from "node:assert/strict";
import { AGGREGATE_IMPORT_PATH, AGGREGATE_MANIFEST_SHA256, PREVIEW_BUCKET } from "../../../web/lib/aggregate-history/policy";
import { importDigest } from "../../../web/lib/aggregate-history/protocol";
import type { R2Bucket } from "../../../web/lib/storage/r2-binding-store";
import type { startWorker } from "../../scripts/local-worker";

export const IMPORT_TEST_SECRET = "local-aggregate-guard-only";
export const IMPORT_GUARD_CONFIGS = [
  { name: "preview", strings: { DEPLOY_ENV: "pre", R2_BUCKET: PREVIEW_BUCKET }, enabled: true },
  { name: "production", strings: { DEPLOY_ENV: "production", R2_BUCKET: "gitstarclub-data-prod" }, enabled: false },
  { name: "production-preview-bucket", strings: { DEPLOY_ENV: "production", R2_BUCKET: PREVIEW_BUCKET }, enabled: false },
  { name: "preview-production-bucket", strings: { DEPLOY_ENV: "pre", R2_BUCKET: "gitstarclub-data-prod" }, enabled: false },
  { name: "missing-mode", strings: { DEPLOY_ENV: "", R2_BUCKET: PREVIEW_BUCKET }, enabled: false },
  { name: "missing-bucket", strings: { DEPLOY_ENV: "pre", R2_BUCKET: "" }, enabled: false },
  { name: "missing-secret", strings: { DEPLOY_ENV: "pre", R2_BUCKET: PREVIEW_BUCKET, CRON_SECRET: "" }, enabled: true, secretConfigured: false },
] satisfies Array<{ name: string; strings: Record<string, string>; enabled: boolean; secretConfigured?: boolean }>;

export type ImportGuardObservation = { scenario: string; path: string; method: string; status: number; headers: string[][]; body: string };

/** Exercise the built host with synthetic local DATA only; never publish or acquire a lease. */
export async function assertAggregateImportGuards(worker: Awaited<ReturnType<typeof startWorker>>, enabled: boolean, secretConfigured = true): Promise<ImportGuardObservation[]> {
  const origin = await worker.ready;
  assert.equal(origin.hostname, "127.0.0.1", "aggregate guard probes must stay loopback-only");
  const bucket = await worker.getR2Bucket("DATA") as unknown as R2Bucket;
  const marker = "_meta/bucket-identity.json";
  const probe = "views/aggregate-guard/probe.json";
  const keys = [marker, probe, "views/latest.json", "bootstrap/latest.json"];
  const before = await Promise.all(keys.map(async (key) => [key, await bucket.get(key).then((value) => value?.text() ?? null)] as const));
  const leaseBefore = await bucket.get("ops/workflows/active.json").then((value) => value?.text() ?? null);
  const report: ImportGuardObservation[] = [];
  const body = JSON.stringify({ action: "read", generation: "bootstrap-aggregate-local-guard", sourceSha256: AGGREGATE_MANIFEST_SHA256, path: probe });
  const transport = new Set(["date", "connection", "keep-alive", "transfer-encoding", "content-length", "content-encoding", "server"]);
  async function call(scenario: string, status: number, method = "POST", authorization: string | null = `Bearer ${IMPORT_TEST_SECRET}`, payload = body, checksum = importDigest(payload), suffix = "") {
    const headers = new Headers({ "content-type": "application/json", "x-gsc-sha256": checksum });
    if (authorization !== null) headers.set("authorization", authorization);
    const response = await fetch(new URL(AGGREGATE_IMPORT_PATH + suffix, origin), {
      method, headers, redirect: "manual", body: ["GET", "HEAD"].includes(method) ? undefined : payload,
    });
    const text = await response.text();
    assert.equal(response.status, status, `${scenario}: ${method} ${AGGREGATE_IMPORT_PATH}${suffix}`);
    assert.equal(response.headers.get("x-gsc-cache"), "BYPASS", scenario);
    assert.equal(response.headers.get("cache-control"), "private, no-store", scenario);
    for (const header of ["x-gsc-publication", "x-robots-tag", "x-vinext-build-id"]) assert(!response.headers.has(header), `${scenario}: no ${header}`);
    assert(response.headers.has("content-security-policy"), `${scenario}: security headers`);
    if (method === "HEAD") assert.equal(text, "");
    report.push({ scenario, path: AGGREGATE_IMPORT_PATH + suffix, method, status: response.status,
      headers: [...response.headers].filter(([name]) => !transport.has(name)), body: text });
    return text;
  }
  try {
    await bucket.put(marker, JSON.stringify({ bucket: PREVIEW_BUCKET, deploy_env: "pre" }));
    await bucket.put(probe, '{"fixture":true}');
    // Pointer corruption must not obscure shell guards or replay the operation.
    await bucket.put("views/latest.json", "invalid");
    await bucket.put("bootstrap/latest.json", "invalid");
    for (const method of ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"]) {
      for (const suffix of ["", "/"]) await call("wrong-method", 404, method, `Bearer ${IMPORT_TEST_SECRET}`, "{", "bad", suffix);
    }
    if (!enabled) {
      for (const authorization of [null, "Bearer wrong", `Bearer ${IMPORT_TEST_SECRET}`]) {
        await call("disabled-before-auth-or-parse", 404, "POST", authorization, "{", "bad");
        await call("disabled-valid-read", 404, "POST", authorization, body, importDigest(body), "/");
      }
      return report;
    }
    await call("missing-bearer", 401, "POST", null);
    await call("wrong-bearer", 401, "POST", "Bearer wrong");
    if (!secretConfigured) { await call("missing-worker-secret", 401); return report; }
    await bucket.delete(marker);
    await call("missing-marker-before-parse", 404, "POST", undefined, "{", "bad");
    for (const identity of [{ bucket: "gitstarclub-data-prod", deploy_env: "pre" }, { bucket: PREVIEW_BUCKET, deploy_env: "production" }]) {
      await bucket.put(marker, JSON.stringify(identity));
      await call("wrong-marker", 404);
    }
    await bucket.put(marker, JSON.stringify({ bucket: PREVIEW_BUCKET, deploy_env: "pre" }));
    await call("bad-checksum", 409, "POST", undefined, body, "0".repeat(64));
    await call("malformed-json", 409, "POST", undefined, "{");
    for (const suffix of ["", "/"]) {
      const result = JSON.parse(await call("valid-read-during-pointer-outage", 200, "POST", undefined, body, importDigest(body), suffix));
      assert.equal(Buffer.from(result.data, "base64").toString(), '{"fixture":true}');
      assert.equal(result.sha256, importDigest('{"fixture":true}'));
    }
    // A successful call must not cache the earlier marker decision.
    await bucket.put(marker, JSON.stringify({ bucket: "gitstarclub-data-prod", deploy_env: "production" }));
    await call("marker-rechecked-after-success", 404);
    return report;
  } finally {
    assert.equal(await bucket.get("ops/workflows/active.json").then((value) => value?.text() ?? null), leaseBefore, "guard/read probes cannot acquire or change a lease");
    for (const [key, value] of before) {
      if (value === null) await bucket.delete(key);
      else await bucket.put(key, value);
    }
  }
}
