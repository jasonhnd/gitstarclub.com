import { describe, expect, test } from "bun:test";
import { WorkflowLease } from "@/lib/contracts";
import { BlobWorkflowLeaseStore } from "@/lib/workflows/lease";
import { ObjectStorePreconditionFailedError } from "./errors";
import {
  BlobFetchNotFoundError,
  BlobFetchPreconditionFailedError,
  createVercelBlobFetchClient,
  parseVercelBlobStoreId,
  VERCEL_BLOB_API_URL,
  VERCEL_BLOB_API_VERSION,
  vercelBlobOriginUrl,
  vercelBlobPublicUrl,
  vercelBlobReadUrl,
} from "./vercel-blob-fetch-client";
import { VercelBlobObjectStore } from "./vercel-blob-store";

const TOKEN = "vercel_blob_rw_cdv7ejjwmzbbdj8w_testsecret";

type Recorded = { method: string; url: string; headers: Headers; body: string; init: RequestInit };

function clientWithFetch(handler: (request: Recorded) => Response | Promise<Response>) {
  const calls: Recorded[] = [];
  const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const recorded: Recorded = {
      method: init.method ?? "GET",
      url,
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? init.body : init.body ? new TextDecoder().decode(init.body as Uint8Array) : "",
      init,
    };
    calls.push(recorded);
    return handler(recorded);
  };
  const client = createVercelBlobFetchClient({
    fetch: fetchImpl,
    apiUrl: VERCEL_BLOB_API_URL,
    publicBaseUrl: "https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com",
    now: () => 1_700_000_000_000,
  });
  return { client, calls };
}

describe("parseVercelBlobStoreId / public URL", () => {
  test("reads the store id from a vercel_blob_rw token", () => {
    expect(parseVercelBlobStoreId(TOKEN)).toBe("cdv7ejjwmzbbdj8w");
    expect(vercelBlobPublicUrl("ops/a.json", TOKEN, "https://blob.example.com/")).toBe("https://blob.example.com/ops/a.json");
    expect(vercelBlobPublicUrl("ops/a.json", TOKEN, "")).toBe(
      "https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com/ops/a.json",
    );
  });

  test("fails closed on a token without a store id", () => {
    expect(() => parseVercelBlobStoreId("not-a-blob-token")).toThrow("unable to extract store ID");
  });

  test("origin URL is the private store hostname and private reads bust cache", () => {
    expect(vercelBlobOriginUrl("ops/workflows/active.json", TOKEN)).toBe(
      "https://cdv7ejjwmzbbdj8w.private.blob.vercel-storage.com/ops/workflows/active.json",
    );
    expect(vercelBlobReadUrl("ops/workflows/active.json", TOKEN, "private")).toBe(
      "https://cdv7ejjwmzbbdj8w.private.blob.vercel-storage.com/ops/workflows/active.json?cache=0",
    );
    expect(vercelBlobReadUrl("ops/a.json", TOKEN, "public", "https://blob.example.com/")).toBe(
      "https://blob.example.com/ops/a.json",
    );
  });
});

describe("createVercelBlobFetchClient", () => {
  test("put uses runtime fetch + official Blob API headers and never sets ALPNProtocols", async () => {
    const { client, calls } = clientWithFetch(() =>
      new Response(JSON.stringify({ etag: '"w1"', url: "https://blob.example.com/ops/a.json" }), { status: 200 }),
    );

    await expect(
      client.put("ops/a.json", '{"ok":true}', {
        access: "public",
        token: TOKEN,
        allowOverwrite: true,
        addRandomSuffix: false,
        contentType: "application/json",
        cacheControlMaxAge: 60,
        ifMatch: '"old"',
      }),
    ).resolves.toEqual({ etag: '"w1"', url: "https://blob.example.com/ops/a.json" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toBe(`${VERCEL_BLOB_API_URL}/?pathname=ops%2Fa.json`);
    expect(calls[0]?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]?.headers.get("x-api-version")).toBe(VERCEL_BLOB_API_VERSION);
    expect(calls[0]?.headers.get("x-vercel-blob-store-id")).toBe("cdv7ejjwmzbbdj8w");
    expect(calls[0]?.headers.get("x-vercel-blob-access")).toBe("public");
    expect(calls[0]?.headers.get("x-allow-overwrite")).toBe("1");
    expect(calls[0]?.headers.get("x-add-random-suffix")).toBe("0");
    expect(calls[0]?.headers.get("x-if-match")).toBe('"old"');
    expect(calls[0]?.headers.get("x-cache-control-max-age")).toBe("60");
    expect(calls[0]?.init).not.toHaveProperty("ALPNProtocols");
    expect(calls[0]?.init).not.toHaveProperty("dispatcher");
    expect(JSON.stringify(calls[0]?.init)).not.toContain("ALPN");
  });

  test("create-only put sends x-allow-overwrite 0 and maps 412 to the SDK error name", async () => {
    const { client, calls } = clientWithFetch(() =>
      new Response(JSON.stringify({ error: { code: "precondition_failed", message: "exists" } }), { status: 412 }),
    );
    await expect(
      client.put("ops/workflows/active.json", "{}", { access: "public", token: TOKEN, allowOverwrite: false }),
    ).rejects.toBeInstanceOf(BlobFetchPreconditionFailedError);
    expect(calls[0]?.headers.get("x-allow-overwrite")).toBe("0");
  });

  test("get/head/list/del stay on fetch and map 404 head to BlobNotFoundError", async () => {
    const { client, calls } = clientWithFetch((request) => {
      if (request.url.includes("/delete")) return new Response(JSON.stringify({}), { status: 200 });
      if (request.url.includes("prefix=")) {
        return new Response(
          JSON.stringify({
            blobs: [{ pathname: "views/a.json", url: "https://blob.example.com/views/a.json", size: 2, etag: '"l1"' }],
            folders: ["views/run-a/"],
            hasMore: false,
          }),
          { status: 200 },
        );
      }
      if (request.url.includes("url=missing")) {
        return new Response(JSON.stringify({ error: { code: "not_found" } }), { status: 404 });
      }
      if (request.method === "GET" && request.url.includes("public.blob.vercel-storage.com")) {
        return new Response('{"ok":true}', { status: 200, headers: { etag: '"g1"', "content-type": "application/json" } });
      }
      if (request.url.includes("url=ops")) {
        return new Response(
          JSON.stringify({
            etag: '"h1"',
            contentType: "application/json",
            size: 11,
            url: "https://blob.example.com/ops/a.json",
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 500 });
    });

    const got = await client.get("ops/a.json", { access: "public", token: TOKEN });
    expect(got?.blob.etag).toBe('"g1"');
    const publicGet = calls.find((call) => call.url.startsWith("https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com/"));
    expect(publicGet?.init.cache).toBe("no-store");
    expect((publicGet?.init as RequestInit & { cf?: { cacheTtl: number } }).cf?.cacheTtl).toBe(0);
    expect(await client.head("ops/a.json", { token: TOKEN })).toEqual({
      etag: '"h1"',
      contentType: "application/json",
      size: 11,
      url: "https://blob.example.com/ops/a.json",
    });
    await expect(client.head("missing.json", { token: TOKEN })).rejects.toBeInstanceOf(BlobFetchNotFoundError);
    const listed = await client.list({ prefix: "views/", mode: "folded", token: TOKEN });
    expect(listed.folders).toEqual(["views/run-a/"]);
    await client.del(["ops/a.json"], { token: TOKEN });
    expect(calls.every((call) => !("ALPNProtocols" in call.init))).toBe(true);
    expect(calls.some((call) => call.url.startsWith("https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com/"))).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/delete"))).toBe(true);
  });

  test("get returns null on 404 so lease reads can start empty", async () => {
    const { client } = clientWithFetch(() => new Response(null, { status: 404 }));
    expect(await client.get("ops/workflows/active.json", { access: "public", token: TOKEN })).toBeNull();
  });

  test("private get uses the origin hostname and does not set ALPNProtocols", async () => {
    const { client, calls } = clientWithFetch((request) => {
      if (request.url.includes("private.blob.vercel-storage.com")) {
        return new Response('{"run_id":"refresh-cf"}', {
          status: 200,
          headers: { etag: '"origin-28"', "content-type": "application/json" },
        });
      }
      return new Response(null, { status: 500 });
    });

    const got = await client.get("ops/workflows/active.json", { access: "private", token: TOKEN });
    expect(got?.blob.etag).toBe('"origin-28"');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://cdv7ejjwmzbbdj8w.private.blob.vercel-storage.com/ops/workflows/active.json?cache=0",
    );
    expect(calls[0]?.init.cache).toBe("no-store");
    expect((calls[0]?.init as RequestInit & { cf?: { cacheTtl: number } }).cf?.cacheTtl).toBe(0);
    expect(calls[0]?.init).not.toHaveProperty("ALPNProtocols");
  });
});

describe("VercelBlobObjectStore + fetch client lease write", () => {
  test("HOSTING_TARGET=cf lease create uses fetch and maps CAS 412", async () => {
    const { client, calls } = clientWithFetch((request) => {
      if (request.headers.get("x-allow-overwrite") === "0") {
        return new Response(JSON.stringify({ error: { code: "precondition_failed" } }), { status: 412 });
      }
      return new Response(JSON.stringify({ etag: '"n1"', url: "https://blob.example.com/ops/workflows/active.json" }), {
        status: 200,
      });
    });
    const objects = new VercelBlobObjectStore(() => TOKEN, client);
    const lease = WorkflowLease.parse({
      run_id: "refresh-cf",
      status: "running",
      acquired_at: "2026-09-19T06:00:00.000Z",
      expires_at: "2026-09-19T06:30:00.000Z",
      fencing_token: 1,
      idempotency_key: "workflow-refresh:2026-W38",
      trigger: "manual-or-cron",
    });
    const store = new BlobWorkflowLeaseStore(undefined, objects);
    expect(await store.create(lease)).toBe(false);
    expect(calls[0]?.url).toContain("vercel.com/api/blob");
    expect(calls[0]?.init).not.toHaveProperty("ALPNProtocols");
    await expect(objects.put("ops/workflows/active.json", "{}", { allowOverwrite: false })).rejects.toBeInstanceOf(
      ObjectStorePreconditionFailedError,
    );
  });
});
