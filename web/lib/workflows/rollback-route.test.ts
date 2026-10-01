import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { POST } from "@/app/api/workflows/refresh/rollback/route";
import { resetBucketIdentityCacheForTests } from "@/lib/runtime-config";
import {
  bindingPreconditionPasses,
  setDataBindingReaderForTests,
  type R2Bucket,
  type R2ObjectHead,
} from "@/lib/storage/r2-binding-store";

type Stored = { body: string; etag: string };

class FakeR2Bucket implements R2Bucket {
  private readonly objects = new Map<string, Stored>();
  private seq = 0;

  constructor(marker: string) {
    this.objects.set("_meta/bucket-identity.json", { body: marker, etag: "identity" });
  }

  private toHead(key: string, stored: Stored): R2ObjectHead & { text: () => Promise<string> } {
    return {
      key,
      size: stored.body.length,
      etag: stored.etag,
      httpEtag: `"${stored.etag}"`,
      httpMetadata: { contentType: "application/json" },
      text: async () => stored.body,
    };
  }

  async get(key: string) {
    const stored = this.objects.get(key);
    return stored ? this.toHead(key, stored) : null;
  }

  async head(key: string) {
    const stored = this.objects.get(key);
    return stored ? this.toHead(key, stored) : null;
  }

  async put(
    key: string,
    value: string | Uint8Array,
    options?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } },
  ) {
    const existing = this.objects.get(key);
    if (!bindingPreconditionPasses(existing?.etag, options?.onlyIf)) return null;
    const body = typeof value === "string" ? value : new TextDecoder().decode(value);
    this.seq += 1;
    const stored = { body, etag: `e${this.seq}` };
    this.objects.set(key, stored);
    return this.toHead(key, stored);
  }

  async delete() {}

  async list() {
    return { objects: [], delimitedPrefixes: [], truncated: false };
  }
}

const realFetch = globalThis.fetch;
const previous = {
  CRON_SECRET: process.env.CRON_SECRET,
  STORAGE_READ_DRIVER: process.env.STORAGE_READ_DRIVER,
  STORAGE_WRITE_DRIVER: process.env.STORAGE_WRITE_DRIVER,
  R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL,
  R2_BUCKET: process.env.R2_BUCKET,
  DEPLOY_ENV: process.env.DEPLOY_ENV,
  BLOB_BASE_URL: process.env.BLOB_BASE_URL,
  NEXT_PUBLIC_BLOB_BASE_URL: process.env.NEXT_PUBLIC_BLOB_BASE_URL,
  BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
};

afterEach(() => {
  globalThis.fetch = realFetch;
  setDataBindingReaderForTests(undefined);
  resetBucketIdentityCacheForTests();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("rollback accepts r2_binding with no Blob env", async () => {
  delete process.env.BLOB_BASE_URL;
  delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  process.env.CRON_SECRET = "test-secret";
  process.env.STORAGE_READ_DRIVER = "r2_binding";
  process.env.STORAGE_WRITE_DRIVER = "r2_binding";
  process.env.R2_PUBLIC_BASE_URL = "https://r2.example.com";
  process.env.R2_BUCKET = "gitstarclub-data-pre";
  process.env.DEPLOY_ENV = "pre";
  const bucket = new FakeR2Bucket(JSON.stringify({ bucket: "gitstarclub-data-pre", deploy_env: "pre" }));
  setDataBindingReaderForTests(() => bucket);
  resetBucketIdentityCacheForTests();
  globalThis.fetch = mock(async () => new Response("missing", { status: 404 })) as unknown as typeof fetch;
  const errorSpy = spyOn(console, "error").mockImplementation(() => {});

  try {
    const response = await POST(
      new Request("https://gitstarclub.com/api/workflows/refresh/rollback", {
        method: "POST",
        headers: {
          authorization: "Bearer test-secret",
          "idempotency-key": "rollback-r2",
          "content-type": "application/json",
        },
        body: JSON.stringify({ target_version: "refresh-2026-07-01T00-00-00-000Z" }),
      }),
    );
    const body = (await response.json()) as { error?: string };
    expect(response.status).toBe(500);
    expect(body.error).toBe("Rollback failed");
  } finally {
    errorSpy.mockRestore();
  }
});
