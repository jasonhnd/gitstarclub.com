import { beforeEach, describe, expect, test } from "bun:test";
import { resetBucketIdentityCacheForTests } from "@/lib/runtime-config";
import { ObjectStorePreconditionFailedError } from "./errors";
import { createR2BindingObjectStore } from "./object-store";
import {
  MISSING_DATA_BINDING_ERROR,
  R2BindingObjectStore,
  resolveDataBinding,
  type R2Bucket,
  type R2HttpMetadata,
  type R2ObjectHead,
  type R2OnlyIf,
} from "./r2-binding-store";

type Stored = {
  body: Uint8Array;
  etag: string;
  httpMetadata?: R2HttpMetadata;
};

type PutCall = {
  key: string;
  onlyIf?: R2OnlyIf;
  httpMetadata?: R2HttpMetadata;
};

class FakeR2Bucket implements R2Bucket {
  readonly objects = new Map<string, Stored>();
  readonly deletes: string[][] = [];
  readonly puts: PutCall[] = [];
  private seq = 0;

  async get(key: string) {
    const stored = this.objects.get(key);
    return stored ? this.toBody(key, stored) : null;
  }

  async head(key: string) {
    const stored = this.objects.get(key);
    return stored ? this.toHead(key, stored) : null;
  }

  async put(key: string, value: string | Uint8Array, options?: { onlyIf?: R2OnlyIf; httpMetadata?: R2HttpMetadata }) {
    this.puts.push({ key, onlyIf: options?.onlyIf, httpMetadata: options?.httpMetadata });
    const existing = this.objects.get(key);
    const onlyIf = options?.onlyIf;
    if (onlyIf?.etagDoesNotMatch === "*" && existing) return null;
    if (onlyIf?.etagMatches) {
      const quoted = existing ? `"${existing.etag}"` : null;
      if (quoted !== onlyIf.etagMatches) return null;
    }
    const body = typeof value === "string" ? new TextEncoder().encode(value) : value;
    this.seq += 1;
    const stored: Stored = {
      body,
      etag: `etag${this.seq}`,
      httpMetadata: options?.httpMetadata,
    };
    this.objects.set(key, stored);
    return this.toHead(key, stored);
  }

  async delete(keys: string | string[]) {
    const batch = Array.isArray(keys) ? keys : [keys];
    this.deletes.push(batch);
    for (const key of batch) this.objects.delete(key);
  }

  async list(options?: { prefix?: string; cursor?: string; limit?: number; delimiter?: string }) {
    const prefix = options?.prefix ?? "";
    const limit = options?.limit ?? 1000;
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    type Entry = { kind: "object"; key: string } | { kind: "prefix"; prefix: string };
    const entries: Entry[] = [];
    if (options?.delimiter) {
      const folders = new Set<string>();
      for (const key of keys) {
        const rest = key.slice(prefix.length);
        const slash = rest.indexOf(options.delimiter);
        if (slash >= 0) folders.add(prefix + rest.slice(0, slash + options.delimiter.length));
        else entries.push({ kind: "object", key });
      }
      for (const folder of [...folders].sort()) entries.push({ kind: "prefix", prefix: folder });
    } else {
      for (const key of keys) entries.push({ kind: "object", key });
    }
    const start = options?.cursor ? Number(options.cursor) : 0;
    const page = entries.slice(start, start + limit);
    const next = start + limit;
    const truncated = next < entries.length;
    return {
      objects: page.flatMap((entry) => {
        if (entry.kind !== "object") return [];
        const stored = this.objects.get(entry.key);
        return stored ? [this.toHead(entry.key, stored)] : [];
      }),
      delimitedPrefixes: page.flatMap((entry) => (entry.kind === "prefix" ? [entry.prefix] : [])),
      truncated,
      cursor: truncated ? String(next) : undefined,
    };
  }

  private toHead(key: string, stored: Stored): R2ObjectHead {
    return {
      key,
      size: stored.body.byteLength,
      etag: stored.etag,
      httpEtag: `"${stored.etag}"`,
      httpMetadata: stored.httpMetadata,
    };
  }

  private toBody(key: string, stored: Stored) {
    return {
      ...this.toHead(key, stored),
      text: async () => new TextDecoder().decode(stored.body),
      arrayBuffer: async () => {
        const copy = new Uint8Array(stored.body.byteLength);
        copy.set(stored.body);
        return copy.buffer as ArrayBuffer;
      },
    };
  }
}

function storeWith(bucket: FakeR2Bucket, prefix = "") {
  return new R2BindingObjectStore({
    bucket,
    bucketName: "gitstarclub-data-pre",
    prefix,
    publicBaseUrl: "https://r2.example.com",
  });
}

describe("R2 binding driver", () => {
  test("create-only put conflict throws ObjectStorePreconditionFailedError", async () => {
    const bucket = new FakeR2Bucket();
    const store = storeWith(bucket);
    await store.put("views/a.json", "{}", { allowOverwrite: false });
    await expect(store.put("views/a.json", "{\"v\":2}", { allowOverwrite: false })).rejects.toBeInstanceOf(
      ObjectStorePreconditionFailedError,
    );
    expect(bucket.puts[0]?.onlyIf).toEqual({ etagDoesNotMatch: "*" });
    expect(bucket.puts[1]?.onlyIf).toEqual({ etagDoesNotMatch: "*" });
    expect(await store.get("views/a.json")).toMatchObject({ body: "{}" });
  });

  test("getBytes keeps non-UTF-8 parquet bytes and refuses a text-only body", async () => {
    const parquet = Uint8Array.from([0x50, 0x41, 0x52, 0x31, 0x00, 0xff, 0x0a, 0x80, 0x7f, 0x1f, 0x8b]);
    const bucket = new FakeR2Bucket();
    const store = storeWith(bucket);
    await store.put("canonical/star_daily.parquet", parquet, { contentType: "application/vnd.apache.parquet" });
    const bytes = await store.getBytes("canonical/star_daily.parquet");
    expect(bytes?.body).toEqual(parquet);
    expect(Buffer.from((await store.get("canonical/star_daily.parquet"))?.body ?? "").equals(Buffer.from(parquet))).toBe(
      false,
    );

    const textOnly: R2Bucket = {
      get: async () => ({
        key: "canonical/star_daily.parquet",
        size: parquet.byteLength,
        etag: "abc",
        httpEtag: '"abc"',
        text: async () => "decoded",
      }),
      head: async () => null,
      put: async () => null,
      delete: async () => undefined,
      list: async () => ({ objects: [], delimitedPrefixes: [], truncated: false }),
    };
    await expect(new R2BindingObjectStore({ bucket: textOnly }).getBytes("canonical/star_daily.parquet")).rejects.toThrow(
      "cannot read binary",
    );
  });

  test("ifMatch succeeds with the etag from get and fails on a mismatch", async () => {
    const bucket = new FakeR2Bucket();
    const store = storeWith(bucket);
    await store.put("views/a.json", "one");
    const etag = (await store.get("views/a.json"))?.etag;
    expect(etag).toBe('"etag1"');
    if (typeof etag !== "string") throw new Error("expected a quoted etag");
    const updated = await store.put("views/a.json", "two", { ifMatch: etag });
    expect(updated.etag).toBe('"etag2"');
    expect((await store.get("views/a.json"))?.body).toBe("two");
    await expect(store.put("views/a.json", "three", { ifMatch: '"stale"' })).rejects.toBeInstanceOf(
      ObjectStorePreconditionFailedError,
    );
    expect((await store.get("views/a.json"))?.body).toBe("two");
  });

  test("get and head of a missing key return null", async () => {
    const store = storeWith(new FakeR2Bucket());
    expect(await store.get("missing.json")).toBeNull();
    expect(await store.head("missing.json")).toBeNull();
  });

  test("folded list returns folders and list paginates with cursor", async () => {
    const bucket = new FakeR2Bucket();
    const store = storeWith(bucket);
    await store.put("views/a.json", "a");
    await store.put("views/b/c.json", "c");
    await store.put("views/b/d.json", "d");
    const folded = await store.list({ prefix: "views/", mode: "folded" });
    expect(folded.blobs.map((blob) => blob.pathname)).toEqual(["views/a.json"]);
    expect(folded.folders).toEqual(["views/b/"]);
    expect(folded.hasMore).toBe(false);

    for (const name of ["p/1", "p/2", "p/3", "p/4", "p/5"]) {
      await store.put(name, name);
    }
    const first = await store.list({ prefix: "p/", limit: 2 });
    expect(first.blobs.map((blob) => blob.pathname)).toEqual(["p/1", "p/2"]);
    expect(first.hasMore).toBe(true);
    expect(first.cursor).toBeTruthy();
    const second = await store.list({ prefix: "p/", limit: 2, cursor: first.cursor });
    expect(second.blobs.map((blob) => blob.pathname)).toEqual(["p/3", "p/4"]);
    expect(second.hasMore).toBe(true);
    const third = await store.list({ prefix: "p/", limit: 2, cursor: second.cursor });
    expect(third.blobs.map((blob) => blob.pathname)).toEqual(["p/5"]);
    expect(third.hasMore).toBe(false);
  });

  test("del of 2500 keys issues 3 batches", async () => {
    const bucket = new FakeR2Bucket();
    const store = storeWith(bucket);
    const keys = Array.from({ length: 2500 }, (_, index) => `k/${index}`);
    await store.del(keys);
    expect(bucket.deletes.map((batch) => batch.length)).toEqual([1000, 1000, 500]);
    expect(bucket.deletes[0]?.[0]).toBe("k/0");
    expect(bucket.deletes[2]?.[499]).toBe("k/2499");
  });

  test("key prefix is applied to put, get, list, and del", async () => {
    const bucket = new FakeR2Bucket();
    const store = storeWith(bucket, "migrate-dev/");
    await store.put("views/a.json", "body", { contentType: "text/plain", cacheControlMaxAge: 60 });
    expect(bucket.puts[0]?.key).toBe("migrate-dev/views/a.json");
    expect(bucket.puts[0]?.httpMetadata).toEqual({
      contentType: "text/plain",
      cacheControl: "public, max-age=60",
    });
    expect((await store.get("views/a.json"))?.body).toBe("body");
    expect((await store.head("views/a.json"))?.contentType).toBe("text/plain");
    await store.put("views/b/c.json", "c");
    const listed = await store.list({ prefix: "views/", mode: "folded" });
    expect(listed.blobs.map((blob) => blob.pathname)).toEqual(["views/a.json"]);
    expect(listed.folders).toEqual(["views/b/"]);
    await store.del("views/a.json");
    expect(bucket.deletes[0]).toEqual(["migrate-dev/views/a.json"]);
    expect(await store.get("views/a.json")).toBeNull();
  });

  test("passes Uint8Array bodies through and quotes a bare etag", async () => {
    const bucket = new FakeR2Bucket();
    const store = storeWith(bucket);
    await store.put("bin/a", new TextEncoder().encode("hi"));
    expect((await store.get("bin/a"))?.body).toBe("hi");

    const bare: R2Bucket = {
      async get() {
        return null;
      },
      async head() {
        return null;
      },
      async delete() {},
      async list() {
        return { objects: [], delimitedPrefixes: [], truncated: false };
      },
      async put() {
        return { key: "a", size: 2, etag: "abc", httpEtag: "" };
      },
    };
    expect((await new R2BindingObjectStore({ bucket: bare }).put("a", "{}")).etag).toBe('"abc"');

    const empty: R2Bucket = {
      ...bare,
      async put() {
        return null;
      },
    };
    await expect(new R2BindingObjectStore({ bucket: empty }).put("a", "{}")).rejects.toThrow("returned no object");
  });

  test("del accepts one key, an r2 URL, and a public URL", async () => {
    const bucket = new FakeR2Bucket();
    const store = storeWith(bucket, "migrate-dev/");
    await store.del([]);
    await store.del("views/a.json");
    await store.del("https://r2.example.com/views/b.json");
    await store.del("r2://gitstarclub-data-pre/migrate-dev/views/c.json");
    expect(bucket.deletes).toEqual([
      ["migrate-dev/views/a.json"],
      ["migrate-dev/views/b.json"],
      ["migrate-dev/views/c.json"],
    ]);
  });

  test("resolveDataBinding throws when the DATA binding is missing", () => {
    expect(() => resolveDataBinding(() => undefined)).toThrow(MISSING_DATA_BINDING_ERROR);
    expect(() => resolveDataBinding(() => ({ get: () => null }))).toThrow(MISSING_DATA_BINDING_ERROR);
    expect(() =>
      resolveDataBinding(() => {
        throw new Error("no cloudflare context");
      }),
    ).toThrow(MISSING_DATA_BINDING_ERROR);
    const bucket = new FakeR2Bucket();
    expect(resolveDataBinding(() => bucket)).toBe(bucket);
  });
});

const bindingEnv = {
  DEPLOY_ENV: "pre",
  R2_BUCKET: "gitstarclub-data-pre",
  R2_PREFIX: "migrate-dev/",
};

function identityBody(deployEnv: "pre" | "production" = "pre") {
  return JSON.stringify({ bucket: "gitstarclub-data-pre", deploy_env: deployEnv });
}

describe("R2 binding bucket-identity guard", () => {
  beforeEach(() => {
    resetBucketIdentityCacheForTests();
  });

  test("refuses a write when the marker is missing or mismatched", async () => {
    const missing = new FakeR2Bucket();
    const missingStore = createR2BindingObjectStore(bindingEnv, { bucket: missing });
    await expect(missingStore.put("views/a.json", "{}")).rejects.toThrow("marker is missing");
    expect(missing.puts).toEqual([]);

    resetBucketIdentityCacheForTests();
    const mismatched = new FakeR2Bucket();
    await mismatched.put("_meta/bucket-identity.json", identityBody("production"));
    const mismatchedStore = createR2BindingObjectStore(bindingEnv, { bucket: mismatched });
    await expect(mismatchedStore.del("views/a.json")).rejects.toThrow("deploy_env=production does not match DEPLOY_ENV=pre");
    expect(mismatched.deletes).toEqual([]);
  });

  test("refuses del of r2 and public URLs that resolve under _meta/", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2BindingObjectStore(
      { ...bindingEnv, R2_PUBLIC_BASE_URL: "https://pub.example" },
      { bucket },
    );
    await expect(store.del("r2://gitstarclub-data-pre/_meta/bucket-identity.json")).rejects.toThrow("keys under _meta/");
    await expect(store.del("https://pub.example/_meta/x")).rejects.toThrow("keys under _meta/");
    await expect(store.del("r2://gitstarclub-data-pre/views/../_meta/x")).rejects.toThrow('"." or ".."');
    expect(bucket.deletes).toEqual([]);
    expect(bucket.puts).toEqual([]);
  });

  test("refuses _meta/x and views/../_meta/x without reading the marker", async () => {
    const bucket = new FakeR2Bucket();
    const store = createR2BindingObjectStore(bindingEnv, { bucket });
    await expect(store.put("_meta/x", "{}")).rejects.toThrow("keys under _meta/");
    await expect(store.del("views/../_meta/x")).rejects.toThrow('"." or ".."');
    await expect(store.put("views/%2e%2e/_meta/x", "{}")).rejects.toThrow('"." or ".."');
    expect(bucket.puts).toEqual([]);
    expect(bucket.deletes).toEqual([]);
  });

  test("a matching marker allows a prefixed write and is read at the bucket root", async () => {
    const bucket = new FakeR2Bucket();
    await bucket.put("_meta/bucket-identity.json", identityBody());
    const seeded = bucket.puts.length;
    const store = createR2BindingObjectStore(bindingEnv, { bucket });
    await store.put("views/a.json", "{}");
    const writes = bucket.puts.slice(seeded);
    expect(writes.map((call) => call.key)).toEqual(["migrate-dev/views/a.json"]);
    expect(bucket.objects.has("_meta/bucket-identity.json")).toBe(true);
    expect(bucket.objects.has("migrate-dev/_meta/bucket-identity.json")).toBe(false);
  });
});
