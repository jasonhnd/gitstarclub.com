import { afterEach, describe, expect, mock, test } from "bun:test";
import { getBlobBaseUrl, requireBlobBaseUrl } from "@/lib/runtime-config";

const originalBlob = process.env.BLOB_BASE_URL;
const originalPublic = process.env.NEXT_PUBLIC_BLOB_BASE_URL;

afterEach(() => {
  if (originalBlob === undefined) delete process.env.BLOB_BASE_URL;
  else process.env.BLOB_BASE_URL = originalBlob;
  if (originalPublic === undefined) delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  else process.env.NEXT_PUBLIC_BLOB_BASE_URL = originalPublic;
  mock.restore();
});

describe("resolveRuntimeEnv via runtime-config", () => {
  test("prefers live Worker env over stale process.env for blob base", async () => {
    delete process.env.BLOB_BASE_URL;
    delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;

    mock.module("@opennextjs/cloudflare", () => ({
      getCloudflareContext: () => ({
        env: {
          BLOB_BASE_URL: "https://worker-bound.example.com",
          JOBS: { send: async () => {} },
        },
      }),
    }));

    const { requireBlobBaseUrl: requireFresh } = await import("@/lib/runtime-config");
    expect(requireFresh()).toBe("https://worker-bound.example.com");
    expect(getBlobBaseUrl()).toBe("https://worker-bound.example.com");
  });
});
