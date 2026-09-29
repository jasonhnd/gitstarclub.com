import { beforeEach, describe, expect, test } from "bun:test";
import { resetBucketIdentityCacheForTests } from "@/lib/runtime-config";
import { DualReadObjectStore } from "./dual-read-store";
import {
  createR2S3ObjectStore,
  createReadObjectStore,
  createWriteObjectStore,
  describeStorageDrivers,
  getReadObjectStore,
  getWriteObjectStore,
  r2StoreConfigFromEnv,
} from "./object-store";
import { R2S3ObjectStore } from "./r2-s3-store";
import { createVercelBlobFetchClient } from "./vercel-blob-fetch-client";
import { VercelBlobObjectStore } from "./vercel-blob-store";

const r2Credentials = {
  R2_ACCESS_KEY_ID: "id",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "gitstarclub-pre",
  R2_ACCOUNT_ID: "00f850e853e4c7f9627233d51a6e30a1",
};

beforeEach(() => {
  resetBucketIdentityCacheForTests();
});

describe("object store factory", () => {
  test("defaults both drivers to Vercel Blob and does not need an R2 token", () => {
    expect(describeStorageDrivers({})).toEqual({ read: "blob", write: "blob" });
    expect(createWriteObjectStore({ STORAGE_WRITE_DRIVER: "blob" })).toBeInstanceOf(VercelBlobObjectStore);
    expect(createReadObjectStore({ STORAGE_READ_DRIVER: "blob" })).toBeInstanceOf(VercelBlobObjectStore);
  });

  test("HOSTING_TARGET=cf blob writes go through runtime fetch, not Node TLS", async () => {
    const calls: RequestInit[] = [];
    const client = createVercelBlobFetchClient({
      fetch: async (_input, init = {}) => {
        calls.push(init);
        return new Response(JSON.stringify({ etag: '"cf1"', url: "https://blob.example.com/ops/a.json" }), { status: 200 });
      },
    });
    const store = new VercelBlobObjectStore(() => "vercel_blob_rw_cdv7ejjwmzbbdj8w_testsecret", client);
    expect(createWriteObjectStore({ HOSTING_TARGET: "cf", STORAGE_WRITE_DRIVER: "blob" })).toBeInstanceOf(VercelBlobObjectStore);
    expect(await store.put("ops/a.json", "{}", { allowOverwrite: true })).toEqual({
      etag: '"cf1"',
      url: "https://blob.example.com/ops/a.json",
    });
    expect(calls[0]).not.toHaveProperty("ALPNProtocols");
    expect(JSON.stringify(calls[0])).not.toContain("ALPN");
  });

  test("refuses a Cloudflare R2 write driver when DEPLOY_ENV is unset without talking to a bucket", () => {
    expect(() =>
      createWriteObjectStore({
        STORAGE_WRITE_DRIVER: "r2",
        HOSTING_TARGET: "cf",
        ...r2Credentials,
      }),
    ).toThrow("unset on Cloudflare");
  });

  test("builds an r2_then_blob read store from env aliases", () => {
    const store = createReadObjectStore({
      READ_DRIVER: "r2_then_blob",
      AWS_ACCESS_KEY_ID: "id",
      AWS_SECRET_ACCESS_KEY: "secret",
      AWS_S3_BUCKET: "gitstarclub-assets",
      R2_ACCOUNT_ID: "00f850e853e4c7f9627233d51a6e30a1",
    });
    expect(store).toBeInstanceOf(DualReadObjectStore);
  });

  test("getReadObjectStore and getWriteObjectStore match the factory", () => {
    expect(getReadObjectStore({ STORAGE_READ_DRIVER: "blob" })).toBeInstanceOf(VercelBlobObjectStore);
    expect(getWriteObjectStore({ STORAGE_WRITE_DRIVER: "blob" })).toBeInstanceOf(VercelBlobObjectStore);
  });

  test("createReadObjectStore can build a pure R2 reader", () => {
    const store = createReadObjectStore({
      STORAGE_READ_DRIVER: "r2",
      R2_ACCESS_KEY_ID: "id",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "gitstarclub-assets",
      R2_ACCOUNT_ID: "00f850e853e4c7f9627233d51a6e30a1",
    });
    expect(store).toBeInstanceOf(R2S3ObjectStore);
  });

  test("R2 config fails closed without credentials", () => {
    expect(() => r2StoreConfigFromEnv({})).toThrow("R2 driver requires");
  });

  test("R2 write config defaults to an empty prefix", () => {
    const config = r2StoreConfigFromEnv(r2Credentials);
    expect(config.prefix).toBe("");
    const store = createWriteObjectStore({
      WRITE_DRIVER: "r2",
      DEPLOY_ENV: "pre",
      ...r2Credentials,
    });
    expect(store).toBeInstanceOf(R2S3ObjectStore);
  });

  test("Blob writes stay on the Blob driver when DEPLOY_ENV is unset", () => {
    expect(createWriteObjectStore({ STORAGE_WRITE_DRIVER: "blob", HOSTING_TARGET: "cf" })).toBeInstanceOf(
      VercelBlobObjectStore,
    );
  });
});

describe("bucket identity write guard", () => {
  function guardedStore(handler: (method: string, url: string) => Response) {
    const calls: string[] = [];
    const store = createR2S3ObjectStore(
      { DEPLOY_ENV: "pre", R2_PREFIX: "migrate-dev/", ...r2Credentials },
      {
        fetch: async (input, init) => {
          const url = String(input);
          const method = init?.method ?? "GET";
          calls.push(`${method} ${url}`);
          return handler(method, url);
        },
      },
    );
    return { store, calls };
  }

  test("DEPLOY_ENV=pre refuses a write when the marker says production", async () => {
    const { store, calls } = guardedStore((_method, url) => {
      if (url.includes("/_meta/bucket-identity.json")) {
        return new Response(JSON.stringify({ bucket: "gitstarclub-pre", deploy_env: "production" }), { status: 200 });
      }
      return new Response(null, { status: 500 });
    });
    await expect(store.put("views/a.json", "{}")).rejects.toThrow(
      "deploy_env=production does not match DEPLOY_ENV=pre",
    );
    expect(calls.some((call) => call.startsWith("PUT"))).toBe(false);
    expect(calls[0]).toContain("/_meta/bucket-identity.json");
    expect(calls[0]).not.toContain("migrate-dev/_meta");
  });

  test("a missing or unreadable marker refuses the write", async () => {
    const missing = guardedStore(() => new Response(null, { status: 404 }));
    await expect(missing.store.put("views/a.json", "{}")).rejects.toThrow("marker is missing");

    resetBucketIdentityCacheForTests();
    const broken = guardedStore(() => new Response("nope", { status: 500 }));
    await expect(broken.store.del("views/a.json")).rejects.toThrow("marker is unreadable");
    expect(broken.calls.some((call) => call.startsWith("DELETE"))).toBe(false);
  });

  test("a matching marker is cached and the following put does not re-read it", async () => {
    let identityReads = 0;
    const { store } = guardedStore((method, url) => {
      if (url.includes("/_meta/bucket-identity.json")) {
        identityReads += 1;
        return new Response(JSON.stringify({ bucket: "gitstarclub-pre", deploy_env: "pre" }), {
          status: 200,
          headers: { etag: '"id"' },
        });
      }
      if (method === "PUT") return new Response(null, { status: 200, headers: { etag: '"1"' } });
      return new Response(null, { status: 500 });
    });
    await store.put("views/a.json", "{}");
    await store.put("views/b.json", "{}");
    expect(identityReads).toBe(1);
  });
});
