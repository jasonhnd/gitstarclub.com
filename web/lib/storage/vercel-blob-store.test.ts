import { describe, expect, mock, test } from "bun:test";
import { ObjectStorePreconditionFailedError } from "./errors";
import { VercelBlobObjectStore, type VercelBlobClient } from "./vercel-blob-store";

function fakeClient(overrides: Partial<VercelBlobClient> = {}): VercelBlobClient {
  return {
    put: mock(async () => ({ etag: '"w1"', url: "https://blob.example.com/ops/a.json" })),
    get: mock(async () => ({
      statusCode: 200 as const,
      stream: new Blob(['{"ok":true}']).stream(),
      headers: new Headers(),
      blob: { etag: '"g1"', contentType: "application/json", size: 11 },
    })),
    head: mock(async () => ({
      etag: '"h1"',
      contentType: "application/json",
      size: 11,
      url: "https://blob.example.com/ops/a.json",
    })),
    list: mock(async () => ({
      blobs: [{ pathname: "views/a.json", url: "https://blob.example.com/views/a.json", size: 2, etag: '"l1"' }],
      folders: ["views/run-a/"],
      cursor: undefined,
      hasMore: false,
    })),
    del: mock(async () => undefined),
    ...overrides,
  } as unknown as VercelBlobClient;
}

describe("VercelBlobObjectStore", () => {
  test("maps put/get/head/list/del and converts 412 to the storage conflict", async () => {
    const client = fakeClient();
    const store = new VercelBlobObjectStore(() => "blob-token", client);
    expect(await store.put("ops/a.json", "{}", { allowOverwrite: true, ifMatch: '"old"' })).toEqual({
      etag: '"w1"',
      url: "https://blob.example.com/ops/a.json",
    });
    expect((await store.get("ops/a.json"))?.etag).toBe('"g1"');
    expect(client.get).toHaveBeenCalledWith("ops/a.json", { access: "public", token: "blob-token" });
    expect((await store.getOrigin("ops/a.json"))?.etag).toBe('"g1"');
    expect(client.get).toHaveBeenCalledWith("ops/a.json", { access: "private", token: "blob-token" });
    expect((await store.head("ops/a.json"))?.etag).toBe('"h1"');
    expect((await store.list({ prefix: "views/", mode: "folded" })).folders).toEqual(["views/run-a/"]);
    await store.del(["https://blob.example.com/views/a.json"]);

    const conflict = new Error("precondition failed");
    conflict.name = "BlobPreconditionFailedError";
    const putting = fakeClient({
      put: mock(async () => {
        throw conflict;
      }),
    });
    await expect(new VercelBlobObjectStore(() => "blob-token", putting).put("ops/a.json", "{}", { allowOverwrite: false })).rejects.toBeInstanceOf(
      ObjectStorePreconditionFailedError,
    );

    const missing = new Error("not found");
    missing.name = "BlobNotFoundError";
    const heading = fakeClient({
      head: mock(async () => {
        throw missing;
      }),
    });
    expect(await new VercelBlobObjectStore(() => "blob-token", heading).head("missing.json")).toBeNull();

    const getting = fakeClient({ get: mock(async () => null) });
    expect(await new VercelBlobObjectStore(() => "blob-token", getting).get("missing.json")).toBeNull();
  });
});
