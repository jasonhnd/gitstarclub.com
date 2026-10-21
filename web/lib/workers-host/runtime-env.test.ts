import { describe, expect, test } from "bun:test";
import { getBlobBaseUrl } from "@/lib/runtime-config";
import { resolveRuntimeEnv, withWorkerEnv, workerBindings } from "./runtime-env";

describe("native Worker environment", () => {
  test("prefers live strings and excludes binding objects", () => withWorkerEnv({ BLOB_BASE_URL: "https://worker.example.com", JOBS: {} }, () => {
    expect(getBlobBaseUrl()).toBe("https://worker.example.com");
    expect(resolveRuntimeEnv({ BLOB_BASE_URL: "https://stale.example.com" }).BLOB_BASE_URL).toBe("https://worker.example.com");
    expect(resolveRuntimeEnv({}).JOBS).toBeUndefined();
  }));
  test("isolates overlapping requests and restores the local fallback", async () => {
    const values = await Promise.all(["a", "b"].map((value) => withWorkerEnv({ VALUE: value }, async () => {
      await Promise.resolve(); return resolveRuntimeEnv({}).VALUE;
    })));
    expect(values).toEqual(["a", "b"]);
    expect(workerBindings()).toEqual({});
    expect(resolveRuntimeEnv({ VALUE: "local" }).VALUE).toBe("local");
  });
});
