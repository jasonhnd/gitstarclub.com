import { describe, expect, test } from "bun:test";
import { DualReadObjectStore } from "./dual-read-store";
import {
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

  test("refuses a production R2 write driver without talking to a bucket", () => {
    expect(() =>
      createWriteObjectStore({
        STORAGE_WRITE_DRIVER: "r2",
        VERCEL_ENV: "production",
        R2_PREFIX: "migrate-dev/",
        R2_ACCESS_KEY_ID: "id",
        R2_SECRET_ACCESS_KEY: "secret",
        R2_BUCKET: "gitstarclub-assets",
        R2_ACCOUNT_ID: "00f850e853e4c7f9627233d51a6e30a1",
      }),
    ).toThrow("VERCEL_ENV=production");
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

  test("non-production R2 write uses the migrate-dev prefix", () => {
    const config = r2StoreConfigFromEnv({
      R2_ACCESS_KEY_ID: "id",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "gitstarclub-assets",
      R2_ACCOUNT_ID: "00f850e853e4c7f9627233d51a6e30a1",
    });
    expect(config.prefix).toBe("migrate-dev/");
    const store = createWriteObjectStore({
      WRITE_DRIVER: "r2",
      VERCEL_ENV: "preview",
      ...{
        R2_ACCESS_KEY_ID: "id",
        R2_SECRET_ACCESS_KEY: "secret",
        R2_BUCKET: "gitstarclub-assets",
        R2_ACCOUNT_ID: "00f850e853e4c7f9627233d51a6e30a1",
      },
    });
    expect(store).toBeInstanceOf(R2S3ObjectStore);
  });
});
