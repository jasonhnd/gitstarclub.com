import { describe, expect, test } from "bun:test";
import { ObjectStorePreconditionFailedError } from "./errors";
import { R2S3ObjectStore } from "./r2-s3-store";

type Recorded = { method: string; url: string; headers: Headers; body: string };

function storeWithFetch(handler: (request: Recorded) => Response | Promise<Response>) {
  const calls: Recorded[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const recorded: Recorded = {
      method: init?.method ?? "GET",
      url,
      headers: new Headers(init?.headers),
      body: init?.body ? new TextDecoder().decode(init.body as Uint8Array) : "",
    };
    calls.push(recorded);
    return handler(recorded);
  };
  const store = new R2S3ObjectStore({
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secret",
    bucket: "gitstarclub-assets",
    endpoint: "https://00f850e853e4c7f9627233d51a6e30a1.r2.cloudflarestorage.com",
    prefix: "migrate-dev/",
    now: () => new Date("2026-09-16T00:00:00.000Z"),
    fetch: fetchImpl,
  });
  return { store, calls };
}

describe("R2 S3 driver", () => {
  test("put sends If-Match and maps 412 to a CAS conflict", async () => {
    const { store, calls } = storeWithFetch((request) => {
      expect(request.headers.get("if-match")).toBe('"old"');
      return new Response(null, { status: 412 });
    });
    await expect(store.put("live/latest.json", '{"ok":true}', { ifMatch: '"old"' })).rejects.toBeInstanceOf(
      ObjectStorePreconditionFailedError,
    );
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toContain("/gitstarclub-assets/migrate-dev/live/latest.json");
  });

  test("create-only put uses If-None-Match *", async () => {
    const { store, calls } = storeWithFetch(() => new Response(null, { status: 412 }));
    await expect(store.put("ops/workflows/active.json", "{}", { allowOverwrite: false })).rejects.toBeInstanceOf(
      ObjectStorePreconditionFailedError,
    );
    expect(calls[0]?.headers.get("if-none-match")).toBe("*");
  });

  test("get/head/list/del stay under the non-production prefix", async () => {
    const { store, calls } = storeWithFetch((request) => {
      if (request.method === "GET" && request.url.includes("list-type=2")) {
        return new Response(
          `<ListBucketResult>
            <Contents><Key>migrate-dev/views/run-a/meta.json</Key><Size>2</Size><ETag>&quot;abc&quot;</ETag></Contents>
            <CommonPrefixes><Prefix>migrate-dev/views/run-a/</Prefix></CommonPrefixes>
            <IsTruncated>false</IsTruncated>
          </ListBucketResult>`,
          { status: 200 },
        );
      }
      if (request.method === "HEAD") return new Response(null, { status: 200, headers: { etag: '"abc"', "content-length": "2" } });
      if (request.method === "GET") return new Response("{}", { status: 200, headers: { etag: '"abc"' } });
      if (request.method === "DELETE") return new Response(null, { status: 204 });
      return new Response(null, { status: 500 });
    });

    expect((await store.get("views/run-a/meta.json"))?.body).toBe("{}");
    expect((await store.head("views/run-a/meta.json"))?.etag).toBe('"abc"');
    const listed = await store.list({ prefix: "views/", mode: "folded" });
    expect(listed.blobs[0]?.pathname).toBe("views/run-a/meta.json");
    expect(listed.folders).toEqual(["views/run-a/"]);
    await store.del("views/run-a/meta.json");
    expect(calls.map((call) => call.method)).toEqual(["GET", "HEAD", "GET", "DELETE"]);
    expect(calls.every((call) => call.url.includes("migrate-dev/") || call.url.includes("prefix=migrate-dev%2F"))).toBe(true);
  });

  test("missing objects are null, not thrown", async () => {
    const { store } = storeWithFetch(() => new Response(null, { status: 404 }));
    expect(await store.get("missing.json")).toBeNull();
    expect(await store.head("missing.json")).toBeNull();
  });
});
