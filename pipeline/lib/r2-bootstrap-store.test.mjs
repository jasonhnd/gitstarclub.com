// @ts-nocheck -- Bun's test globals are intentionally outside the production JS typecheck roots.
import { describe, expect, test } from "bun:test";
import { commitBootstrapGeneration, stageBootstrapPhase } from "./bootstrap-publication.mjs";
import { createR2BootstrapStore } from "./r2-bootstrap-store.mjs";
import { sha256Hex } from "./s3-sign.mjs";
import { withUploadRetry } from "./upload-retry.mjs";

const NOW = new Date("2026-07-17T00:00:00.000Z");
const PRE_BUCKET = "gitstarclub-data-pre";
const ENDPOINT = "https://example.r2.cloudflarestorage.com";

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

  function seedIdentity(identity = { bucket: PRE_BUCKET, deploy_env: "pre" }) {
    seed("_meta/bucket-identity.json", JSON.stringify(identity), '"identity"');
  }

  async function fetchImpl(input, init = {}) {
    const method = init.method ?? "GET";
    const { bucket, key } = keyFrom(input);
    requests.push({ method, bucket, key });
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

  return {
    objects,
    requests,
    seed,
    seedIdentity,
    fetch: fetchImpl,
    writes() {
      return requests.filter((request) => request.method === "PUT" || request.method === "POST" || request.method === "DELETE");
    },
  };
}

function storeFor(fake, target = "pre", bucket = PRE_BUCKET, options = {}) {
  return createR2BootstrapStore({
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-not-printed",
    bucket,
    endpoint: ENDPOINT,
    target,
    fetch: fake.fetch,
    now: () => NOW,
    ...options,
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Keep removed-fix runs bounded too: a hung store must fail this assertion,
// rather than relying on Bun's much longer per-test timeout.
async function guarded(operation) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("store did not settle within the test guard")), 500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function deadlineStore(fetch) {
  return storeFor({ fetch }, "pre", PRE_BUCKET, { requestTimeoutMs: 20 });
}

const phaseItems = (phase) => {
  const prefix = phase === "canonical" ? "canonical/v2" : phase;
  return [
    { path: `${prefix}/a.json`, body: Buffer.from('{"ok":true}'), contentType: "application/json" },
    { path: `${prefix}/b.json`, body: Buffer.from('{"ok":false}'), contentType: "application/json" },
  ];
};

describe("R2 bootstrap store", () => {
  test("rejects invalid deadlines before issuing a request", () => {
    for (const requestTimeoutMs of [0, -1, 0.5, NaN, Infinity, 2_147_483_648]) {
      expect(() => storeFor({}, "pre", PRE_BUCKET, { requestTimeoutMs }))
        .toThrow(/positive integer within the timer range/);
    }
  });

  test("aborts never-settling headers even when fetch ignores the signal", async () => {
    let signal;
    const store = deadlineStore(async (_input, init) => {
      signal = init.signal;
      return new Promise(() => {});
    });
    await expect(guarded(store.readSnapshot("views/a.json"))).rejects.toThrow(/timed out after 20ms/);
    expect(signal.aborted).toBe(true);
    expect(signal.reason.name).toBe("TimeoutError");
    expect(signal.reason.message).not.toContain("test-secret-not-printed");
    expect(signal.reason.message).not.toContain(ENDPOINT);
  });

  test.each([200, 404, 412, 500])("aborts never-settling response bodies for HTTP %i", async (status) => {
    let signal;
    const store = deadlineStore(async (_input, init) => {
      signal = init.signal;
      return { status, headers: new Headers({ etag: '"body"' }), arrayBuffer: () => new Promise(() => {}) };
    });
    await expect(guarded(store.read("views/a.json"))).rejects.toThrow(/timed out after 20ms/);
    expect(signal.aborted).toBe(true);
  });

  test.each(["headers", "body"])("an identity %s timeout refuses all writes", async (stall) => {
    const methods = [];
    let signal;
    const store = deadlineStore(async (_input, init) => {
      methods.push(init.method);
      signal = init.signal;
      if (stall === "headers") return new Promise(() => {});
      return { status: 200, headers: new Headers(), arrayBuffer: () => new Promise(() => {}) };
    });
    await expect(guarded(store.put("views/a.json", Buffer.from("x")))).rejects.toThrow(
      /identity marker is unreadable .*timed out after 20ms/,
    );
    expect(methods).toEqual(["GET"]);
    expect(signal.aborted).toBe(true);
  });

  test.each(["create", "createMutable", "compareAndSet", "put", "delete"])(
    "%s aborts a stalled signed write after identity verification",
    async (method) => {
      const fake = createFakeR2();
      fake.seedIdentity();
      let signal;
      let signed;
      const store = deadlineStore(async (input, init) => {
        if (String(input).endsWith("_meta/bucket-identity.json")) return fake.fetch(input, init);
        signal = init.signal;
        signed = init.headers;
        return new Promise(() => {});
      });
      const operation = method === "compareAndSet"
        ? store[method]("views/a.json", '"expected"', Buffer.from("x"))
        : store[method]("views/a.json", Buffer.from("x"));
      await expect(guarded(operation)).rejects.toThrow(/timed out after 20ms/);
      expect(signal.aborted).toBe(true);
      expect(header(signed, "authorization")).toContain("AWS4-HMAC-SHA256");
      if (method === "compareAndSet") expect(header(signed, "if-match")).toBe('"expected"');
      if (method === "create" || method === "createMutable") expect(header(signed, "if-none-match")).toBe("*");
    },
  );

  test("keeps the same deadline after headers arrive", async () => {
    let signal;
    const store = deadlineStore(async (_input, init) => {
      signal = init.signal;
      await delay(12);
      return {
        status: 200,
        headers: new Headers(),
        arrayBuffer: async () => { await delay(12); return new ArrayBuffer(0); },
      };
    });
    await expect(guarded(store.read("views/a.json"))).rejects.toThrow(/timed out after 20ms/);
    expect(signal.aborted).toBe(true);
  });

  test("does not start a body read when ignored cancellation delivers late headers", async () => {
    let finishHeaders;
    let reads = 0;
    const store = deadlineStore(() => new Promise((resolve) => { finishHeaders = resolve; }));
    await expect(guarded(store.read("views/a.json"))).rejects.toThrow(/timed out after 20ms/);
    finishHeaders({
      status: 200,
      headers: new Headers(),
      arrayBuffer: async () => { reads++; return new ArrayBuffer(0); },
    });
    await delay(0);
    expect(reads).toBe(0);
  });

  test("clears deadlines on success, fetch failure, and body failure", async () => {
    const signals = [];
    const success = deadlineStore(async (_input, init) => {
      signals.push(init.signal);
      return new Response(Buffer.from([0, 255, 128]), { headers: { etag: '"same-response"' } });
    });
    const snapshot = await success.readSnapshot("views/a.json");
    expect(snapshot).toEqual({ body: Buffer.from([0, 255, 128]), etag: '"same-response"' });
    for (const phase of ["fetch", "body"]) {
      const failure = deadlineStore(async (_input, init) => {
        signals.push(init.signal);
        if (phase === "fetch") throw new Error("fetch failed");
        return { arrayBuffer: async () => { throw new Error("body failed"); } };
      });
      await expect(failure.read("views/a.json")).rejects.toThrow(`${phase} failed`);
    }
    await delay(40);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
  });

  test("a response-lost create timeout can retry without overwriting immutable bytes", async () => {
    const fake = createFakeR2();
    fake.seedIdentity();
    let attempts = 0;
    let firstSignal;
    const store = deadlineStore(async (input, init) => {
      const response = await fake.fetch(input, init);
      if (init.method === "PUT" && ++attempts === 1) {
        firstSignal = init.signal;
        return new Promise(() => {});
      }
      return response;
    });
    const retry = withUploadRetry(store, { retries: 1, sleep: async () => {} });
    expect(await guarded(retry.create("views/a.json", Buffer.from("first")))).toBe(false);
    expect(attempts).toBe(2);
    expect(firstSignal.aborted).toBe(true);
    expect(await store.read("views/a.json")).toEqual(Buffer.from("first"));
  });

  test("round-trips a parquet-like buffer without text decoding", async () => {
    const fake = createFakeR2();
    fake.seedIdentity();
    const store = storeFor(fake);
    const payload = Buffer.from([0x50, 0x41, 0x52, 0x31, 0x00, 0xff, 0x0a, 0x80, 0x7f, 0x1f, 0x8b]);
    await store.put("canonical/star_daily.parquet", payload, "application/vnd.apache.parquet");
    const round = await store.read("canonical/star_daily.parquet");
    expect(Buffer.isBuffer(round)).toBe(true);
    expect(Buffer.compare(round, payload)).toBe(0);
  });

  test("create-only conflict returns false and keeps the original bytes", async () => {
    const fake = createFakeR2();
    fake.seedIdentity();
    const store = storeFor(fake);
    expect(await store.create("views/a.json", Buffer.from("first"))).toBe(true);
    expect(await store.create("views/a.json", Buffer.from("second"))).toBe(false);
    expect(Buffer.compare(await store.read("views/a.json"), Buffer.from("first"))).toBe(0);
    const created = fake.requests.filter((request) => request.method === "PUT" && request.key === "views/a.json");
    expect(created.length).toBe(2);
  });

  test("compareAndSet with a stale etag returns false", async () => {
    const fake = createFakeR2();
    fake.seedIdentity();
    const store = storeFor(fake);
    await store.put("ops/workflows/active.json", Buffer.from("one"));
    const snapshot = await store.readSnapshot("ops/workflows/active.json");
    expect(await store.compareAndSet("ops/workflows/active.json", '"stale"', Buffer.from("two"))).toBe(false);
    expect(Buffer.compare(await store.read("ops/workflows/active.json"), Buffer.from("one"))).toBe(0);
    expect(await store.compareAndSet("ops/workflows/active.json", snapshot.etag, Buffer.from("two"))).toBe(true);
    expect(Buffer.compare(await store.read("ops/workflows/active.json"), Buffer.from("two"))).toBe(0);
  });

  test("compareAndSet with an empty etag sends no request", async () => {
    const fake = createFakeR2();
    fake.seedIdentity();
    const store = storeFor(fake);
    await store.put("ops/workflows/active.json", Buffer.from("one"));
    const before = fake.requests.length;
    for (const etag of [null, undefined, "", "   "]) {
      await expect(store.compareAndSet("ops/workflows/active.json", etag, Buffer.from("two"))).rejects.toThrow(
        /requires a non-empty etag/,
      );
    }
    expect(fake.requests).toHaveLength(before);
    expect(Buffer.compare(await store.read("ops/workflows/active.json"), Buffer.from("one"))).toBe(0);
  });

  test("refuses a missing, wrong-bucket, or wrong-env identity marker before any write", async () => {
    const missing = createFakeR2();
    await expect(storeFor(missing).put("views/a.json", Buffer.from("x"))).rejects.toThrow(/marker is missing/);
    expect(missing.writes()).toHaveLength(0);

    const wrongBucket = createFakeR2();
    wrongBucket.seedIdentity({ bucket: "other-bucket", deploy_env: "pre" });
    await expect(storeFor(wrongBucket).create("views/a.json", Buffer.from("x"))).rejects.toThrow(/does not match target/);
    expect(wrongBucket.writes()).toHaveLength(0);

    const wrongEnv = createFakeR2();
    wrongEnv.seedIdentity({ bucket: PRE_BUCKET, deploy_env: "production" });
    await expect(storeFor(wrongEnv).compareAndSet("views/a.json", '"nope"', Buffer.from("x"))).rejects.toThrow(
      /deploy_env=production/,
    );
    expect(wrongEnv.writes()).toHaveLength(0);
  });

  test("refuses writes and deletes under _meta before any request", async () => {
    const fake = createFakeR2();
    const store = storeFor(fake);
    await expect(store.put("_meta/bucket-identity.json", Buffer.from("{}"))).rejects.toThrow(/_meta/);
    await expect(store.delete("_meta/bucket-identity.json")).rejects.toThrow(/_meta/);
    await expect(store.create("views/../_meta/x.json", Buffer.from("x"))).rejects.toThrow(/\.\./);
    expect(fake.requests).toHaveLength(0);
  });

  test("initial commit on an empty bucket publishes previous_generation null and refuses views or canonical markers", async () => {
    const fake = createFakeR2();
    fake.seedIdentity();
    const store = storeFor(fake);
    await stageBootstrapPhase({
      generation: "bootstrap-empty",
      phase: "base",
      items: phaseItems("views"),
      store,
      concurrency: 1,
    });
    await stageBootstrapPhase({
      generation: "bootstrap-empty",
      phase: "canonical",
      items: phaseItems("canonical"),
      store,
      concurrency: 1,
    });
    const published = await commitBootstrapGeneration({
      generation: "bootstrap-empty",
      store,
      initialCommit: true,
      now: () => "2026-07-17T00:00:00.000Z",
    });
    expect(published.status).toBe("published");
    expect(published.pointer.previous_generation).toBeNull();

    const views = createFakeR2();
    views.seedIdentity();
    views.seed("views/latest.json", Buffer.from("{}"));
    const viewsStore = storeFor(views);
    await stageBootstrapPhase({
      generation: "bootstrap-views",
      phase: "base",
      items: phaseItems("views"),
      store: viewsStore,
      concurrency: 1,
    });
    await stageBootstrapPhase({
      generation: "bootstrap-views",
      phase: "canonical",
      items: phaseItems("canonical"),
      store: viewsStore,
      concurrency: 1,
    });
    const writesBefore = views.writes().length;
    await expect(
      commitBootstrapGeneration({ generation: "bootstrap-views", store: viewsStore, initialCommit: true }),
    ).rejects.toThrow("views/latest.json already exists");
    expect(views.writes().length).toBe(writesBefore);
    expect(views.objects.has("bootstrap/latest.json")).toBe(false);

    const canonical = createFakeR2();
    canonical.seedIdentity();
    canonical.seed("canonical/v2/meta.json", Buffer.from("{}"));
    const canonicalStore = storeFor(canonical);
    await stageBootstrapPhase({
      generation: "bootstrap-canon",
      phase: "base",
      items: phaseItems("views"),
      store: canonicalStore,
      concurrency: 1,
    });
    await stageBootstrapPhase({
      generation: "bootstrap-canon",
      phase: "canonical",
      items: phaseItems("canonical"),
      store: canonicalStore,
      concurrency: 1,
    });
    await expect(
      commitBootstrapGeneration({ generation: "bootstrap-canon", store: canonicalStore, initialCommit: true }),
    ).rejects.toThrow("canonical/v2/meta.json already exists");
    expect(canonical.objects.has("bootstrap/latest.json")).toBe(false);
  });
});
