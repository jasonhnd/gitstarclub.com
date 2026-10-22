import { describe, expect, test } from "bun:test";
import { buildBootstrapPhaseManifest } from "../../../pipeline/lib/bootstrap-publication.mjs";
import { type R2Bucket } from "../storage/r2-binding-store";
import { classifyWorkerRequest } from "../workers-host/shell-routes";
import { AGGREGATE_IMPORT_PATH, PREVIEW_BUCKET } from "./policy";
import { importDigest } from "./protocol";
import { handleAggregateImport } from "./worker";
import { importWorkerHarness as harness } from "./test-support";

const GEN = "bootstrap-aggregate-worker-test";
const SECRET = "aggregate-test-secret";
const encode = (value: unknown) => JSON.stringify(value);


async function begin(h: ReturnType<typeof harness>): Promise<number> {
  const response = await h.request({ action: "begin" });
  expect(response.status).toBe(200);
  return (await response.json() as { token: number }).token;
}

const items = (path = "views/meta.json") => [{ path, data: Buffer.from("{}").toString("base64"), sha256: importDigest("{}") }];

describe("preview Worker aggregate protocol", () => {
  test("production and invalid configurations refuse every verb before DATA access or auth", async () => {
    for (const method of ["POST", "GET", "HEAD", "PUT", "DELETE"]) {
      expect(classifyWorkerRequest(`${AGGREGATE_IMPORT_PATH}/`, method)).toBe("shell");
      for (const config of [{ DEPLOY_ENV: "production", R2_BUCKET: PREVIEW_BUCKET }, { DEPLOY_ENV: "pre", R2_BUCKET: "gitstarclub-data-prod" }, { R2_BUCKET: PREVIEW_BUCKET }, { DEPLOY_ENV: "pre" }]) {
        const response = await handleAggregateImport(new Request(`https://gitstarclub.com${AGGREGATE_IMPORT_PATH}`, { method }), { ...config, get DATA(): R2Bucket { throw new Error("must never read DATA"); } });
        expect(response.status).toBe(404);
      }
    }
  });

  test("requires the explicit Worker secret and the actual bound bucket identity", async () => {
    const h = harness();
    expect((await h.request({ action: "begin" }, { CRON_SECRET: "" })).status).toBe(401);
    expect(h.bucket.counter.total).toBe(0);
    const previous = process.env.CRON_SECRET;
    try {
      process.env.CRON_SECRET = SECRET;
      expect((await h.request({ action: "begin" }, { CRON_SECRET: undefined })).status).toBe(401);
    } finally { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous; }
    await h.bucket.store.put("_meta/bucket-identity.json", encode({ bucket: "gitstarclub-data-prod", deploy_env: "production" }));
    expect((await h.request({ action: "begin" })).status).toBe(404);
    expect(h.bucket.writes).toHaveLength(0);
  });

  test("checks request and object checksums; refuses private paths and unscoped operations", async () => {
    const h = harness();
    const bad = await handleAggregateImport(new Request(`https://pre.gitstarclub.com${AGGREGATE_IMPORT_PATH}`, { method: "POST", headers: { authorization: `Bearer ${SECRET}` }, body: "{}" }), h.env);
    expect(bad.status).toBe(409);
    const token = await begin(h);
    for (const body of [
      { action: "stage", target: GEN, phase: "base", items: [{ ...items()[0], sha256: "0".repeat(64) }] },
      { action: "stage", target: GEN, phase: "base", items: items("views/../inputs/manifest.json") },
      { action: "stage", target: "bootstrap-other", phase: "base", items: items() },
      { action: "stage", target: GEN, phase: "base", items: [{ path: "views/meta.json", data: Buffer.from(encode({ source: "/Users/private/export" })).toString("base64"), sha256: importDigest(encode({ source: "/Users/private/export" })) }] },
      { action: "read", path: "secrets/private.json" },
      { action: "list", prefix: "ops/" },
      { action: "put", path: "bootstrap/latest.json", body: "{}" },
    ]) expect((await h.request({ ...body, ...(body.action === "stage" ? { token } : {}) })).status).toBe(409);
    expect(await h.bucket.store.get("bootstrap/latest.json")).toBeNull();
    expect(h.bucket.writes.filter((w) => w.path.startsWith("bootstrap/generations/"))).toHaveLength(0);
  });

  test("rejects unpinned sources and oversized requests/chunks before generation writes", async () => {
    const h = harness();
    expect((await h.request({ action: "begin", sourceSha256: "0".repeat(64) })).status).toBe(409);
    const token = await begin(h);
    expect((await h.request({ action: "stage", token, target: GEN, phase: "base", items: Array.from({ length: 17 }, (_, i) => items(`views/${i}.json`)[0]) })).status).toBe(409);
    const huge = encode({ padding: "x".repeat(4 * 1024 * 1024) });
    const item = { path: "views/large.json", data: Buffer.from(huge).toString("base64"), sha256: importDigest(huge) };
    expect((await h.request({ action: "stage", token, target: GEN, phase: "base", items: [item] })).status).toBe(409);
    const overflow = encode({ padding: "x".repeat(8 * 1024 * 1024) });
    expect((await handleAggregateImport(new Request(`https://pre.gitstarclub.com${AGGREGATE_IMPORT_PATH}`, { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "x-gsc-sha256": importDigest(overflow) }, body: overflow }), h.env)).status).toBe(409);
    expect(h.bucket.writes.filter((w) => w.path.startsWith("bootstrap/generations/"))).toHaveLength(0);
  });

  test("begin response loss, chunk replay, interrupted transfer and immutable conflicts are safe", async () => {
    const h = harness();
    const token = await begin(h);
    expect(await begin(h)).toBe(token);
    const stage = { action: "stage", token, target: GEN, phase: "base", items: items() };
    expect((await h.request(stage)).status).toBe(200);
    const replay = await h.request(stage);
    expect(await replay.json()).toMatchObject({ replay: true });
    const changed = encode({ changed: true });
    expect((await h.request({ ...stage, items: [{ ...items()[0], data: Buffer.from(changed).toString("base64"), sha256: importDigest(changed) }] })).status).toBe(409);
    const more = { ...stage, items: [...items("views/one.json"), ...items("views/two.json")] };
    h.bucket.failPut = (path) => path.endsWith("/two.json");
    expect((await h.request(more)).status).toBe(409);
    h.bucket.failPut = undefined;
    expect((await h.request(more)).status).toBe(200);
    expect(h.bucket.writes.every((w) => w.onlyIf?.etagDoesNotMatch === "*" || !!w.onlyIf?.etagMatches)).toBe(true);
  });

  test("verification resumes from its durable cursor and refuses corrupted objects", async () => {
    const h = harness(); const token = await begin(h);
    const objects = Array.from({ length: 40 }, (_, i) => ({ path: `views/test/${i}.json`, body: Buffer.from("{}") }));
    for (let i = 0; i < objects.length; i += 16) {
      const chunk = objects.slice(i, i + 16).map((item) => ({ path: item.path, data: item.body.toString("base64"), sha256: importDigest(item.body) }));
      expect((await h.request({ action: "stage", token, target: GEN, phase: "base", items: chunk })).status).toBe(200);
    }
    const manifest = buildBootstrapPhaseManifest(GEN, "base", objects);
    expect((await h.request({ action: "seal", token, target: GEN, phase: "base", data: Buffer.from(encode(manifest)).toString("base64") })).status).toBe(200);
    expect((await h.request({ action: "verify", token, target: GEN, phase: "base" })).status).toBe(200);
    const next = await h.request({ action: "verify", token, target: GEN, phase: "base" });
    expect(await next.json()).toMatchObject({ complete: true, cursor: 40 });
    expect((await h.request({ action: "stage", token, target: GEN, phase: "base", items: items("views/extra.json") })).status).toBe(409);
    // Corrupt a still-unverified object in a new phase, simulating storage damage.
    const canonical = [{ path: "canonical/v2/meta.json", body: Buffer.from("{}") }];
    const sealed = buildBootstrapPhaseManifest(GEN, "canonical", canonical);
    await h.bucket.store.put(`bootstrap/generations/${GEN}/canonical/v2/meta.json`, "corrupted");
    expect((await h.request({ action: "seal", token, target: GEN, phase: "canonical", data: Buffer.from(encode(sealed)).toString("base64") })).status).toBe(200);
    expect((await h.request({ action: "verify", token, target: GEN, phase: "canonical" })).status).toBe(409);
    expect((await h.request({ action: "commit", token, recovery: true })).status).toBe(409);
    expect(await h.bucket.store.get("bootstrap/latest.json")).toBeNull();
    expect(h.maximum()).toBeLessThan(128);
  });

  test("a repeated release cannot regress a terminal same-token status", async () => {
    const h = harness(); const token = await begin(h);
    expect((await h.request({ action: "release", token, status: "published" })).status).toBe(200);
    expect((await h.request({ action: "release", token, status: "failed" })).status).toBe(200);
    expect(JSON.parse((await h.bucket.store.get("ops/workflows/active.json"))!.body).status).toBe("published");
  });

  test("expired sessions acquire a new token and cannot revive the old owner", async () => {
    const h = harness(); const token = await begin(h);
    const current = JSON.parse((await h.bucket.store.get("ops/workflows/active.json"))!.body);
    await h.bucket.store.put("ops/workflows/active.json", encode({ ...current, expires_at: "2020-01-01T00:00:00Z" }));
    expect((await h.request({ action: "renew", token })).status).toBe(409);
    const successor = await begin(h);
    expect(successor).toBe(token + 1);
    expect((await h.request({ action: "stage", token, target: GEN, phase: "base", items: items() })).status).toBe(409);
    expect((await h.request({ action: "stage", token: successor, target: GEN, phase: "base", items: items() })).status).toBe(200);
  });

  test("a successor fences every old mutation and cannot be released by the old client", async () => {
    const h = harness(); const token = await begin(h);
    await h.bucket.store.put("ops/workflows/active.json", encode({ run_id: "successor", status: "running", fencing_token: token + 1, expires_at: "2099-01-01T00:00:00Z" }));
    for (const body of [
      { action: "renew" }, { action: "stage", target: GEN, phase: "base", items: items() },
      { action: "verify", target: GEN, phase: "base" }, { action: "commit", recovery: true }, { action: "release", status: "failed" },
    ]) expect((await h.request({ ...body, token })).status).toBe(409);
    expect(JSON.parse((await h.bucket.store.get("ops/workflows/active.json"))!.body).run_id).toBe("successor");
  });
});
