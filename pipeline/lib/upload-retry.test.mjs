// @ts-nocheck -- Bun's test globals are intentionally outside the production JS typecheck roots.
import { describe, expect, test } from "bun:test";
import { parseBootstrapArgs, runRemoteStage } from "./bootstrap-cli.mjs";
import { withBootstrapPublicationLease } from "./bootstrap-lease.mjs";
import { commitBootstrapGeneration, stageBootstrapPhase } from "./bootstrap-publication.mjs";
import { createR2BootstrapStore } from "./r2-bootstrap-store.mjs";
import { sha256Hex } from "./s3-sign.mjs";
import { withUploadRetry } from "./upload-retry.mjs";

const NOW = new Date("2026-07-17T00:00:00.000Z");
const PRE_BUCKET = "gitstarclub-data-pre";
const ENDPOINT = "https://example.r2.cloudflarestorage.com";
const GENERATION = "bootstrap-initial-wrap";

function header(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name);
  const found = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  return found ? headers[found] : undefined;
}

function createFakeR2() {
  const objects = new Map();
  const requests = [];
  let version = 0;

  function keyFrom(input) {
    const url = input instanceof URL ? input : new URL(String(input));
    const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    return { bucket: parts[0], key: parts.slice(1).join("/") };
  }

  function seed(key, body, etag = `"seed-${++version}"`) {
    objects.set(key, { body: Buffer.from(body), etag });
  }

  async function fetchImpl(input, init = {}) {
    const method = init.method ?? "GET";
    const { bucket, key } = keyFrom(input);
    requests.push({
      method,
      bucket,
      key,
      ifNoneMatch: header(init.headers, "if-none-match"),
    });
    if (method === "GET") {
      const existing = objects.get(key);
      if (!existing) return new Response(null, { status: 404 });
      return new Response(existing.body, { status: 200, headers: { etag: existing.etag } });
    }
    if (method === "DELETE") {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    if (method === "PUT") {
      const existing = objects.get(key);
      const ifNone = header(init.headers, "if-none-match");
      const ifMatch = header(init.headers, "if-match");
      if (ifNone === "*" && existing) return new Response("conflict", { status: 412 });
      if (ifMatch && (!existing || existing.etag !== ifMatch)) return new Response("stale", { status: 412 });
      const body = Buffer.from(init.body ?? Buffer.alloc(0));
      const etag = `"${sha256Hex(body).slice(0, 16)}"`;
      objects.set(key, { body, etag });
      return new Response(null, { status: 200, headers: { etag } });
    }
    return new Response("unsupported", { status: 500 });
  }

  return { objects, requests, seed, fetch: fetchImpl };
}

describe("upload retry wrapper", () => {
  test("initial commit through the 07 wrapper publishes previous_generation null", async () => {
    const fake = createFakeR2();
    fake.seed("_meta/bucket-identity.json", JSON.stringify({ bucket: PRE_BUCKET, deploy_env: "pre" }), '"identity"');
    const cli = parseBootstrapArgs([
      "--store",
      "r2",
      "--target",
      "pre",
      "--generation",
      GENERATION,
      "--execute",
      "--initial-commit",
    ]);
    const env = {
      R2_BUCKET_PRE: PRE_BUCKET,
      R2_ACCESS_KEY_ID: "test-access-key",
      R2_SECRET_ACCESS_KEY: "test-secret-not-printed",
      R2_S3_ENDPOINT: ENDPOINT,
    };
    const phaseItems = (phase) => {
      const prefix = phase === "canonical" ? "canonical/v2" : "views";
      return [
        { path: `${prefix}/a.json`, body: Buffer.from('{"ok":true}'), contentType: "application/json" },
        { path: `${prefix}/b.json`, body: Buffer.from('{"ok":false}'), contentType: "application/json" },
      ];
    };

    const outcome = await runRemoteStage({
      cli,
      env,
      fetch: fake.fetch,
      now: () => NOW,
      stage: async (raw) => {
        const store = withUploadRetry(raw);
        await stageBootstrapPhase({
          generation: GENERATION,
          phase: "base",
          items: phaseItems("base"),
          store,
          concurrency: 1,
        });
        await stageBootstrapPhase({
          generation: GENERATION,
          phase: "canonical",
          items: phaseItems("canonical"),
          store,
          concurrency: 1,
        });
        return withBootstrapPublicationLease({
          store: raw,
          generation: GENERATION,
          operation: "publish",
          run: (assertCanCommit) =>
            commitBootstrapGeneration({
              generation: GENERATION,
              store,
              initialCommit: cli.initialCommit,
              assertCanCommit,
              now: () => "2026-07-17T00:00:00.000Z",
            }),
        });
      },
    });

    expect(outcome.action).toBe("wrote");
    expect(outcome.result.status).toBe("published");
    expect(outcome.result.pointer.previous_generation).toBeNull();
    expect(outcome.result.pointer.generation).toBe(GENERATION);
    const pointerPuts = fake.requests.filter(
      (request) => request.method === "PUT" && request.key === "bootstrap/latest.json",
    );
    expect(pointerPuts).toEqual([{ method: "PUT", bucket: PRE_BUCKET, key: "bootstrap/latest.json", ifNoneMatch: "*" }]);
    const pointer = JSON.parse(fake.objects.get("bootstrap/latest.json").body.toString("utf8"));
    expect(pointer.previous_generation).toBeNull();

    const raw = createR2BootstrapStore({
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-not-printed",
      bucket: PRE_BUCKET,
      endpoint: ENDPOINT,
      target: "pre",
      fetch: fake.fetch,
      now: () => NOW,
    });
    expect(typeof withUploadRetry(raw).createMutable).toBe("function");
  });
});
