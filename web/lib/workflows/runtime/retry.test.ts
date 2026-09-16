import { describe, expect, test } from "bun:test";
import { WorkflowLeaseOwnershipError } from "@/lib/workflows/lease";
import { withStepRetry } from "./retry";

describe("withStepRetry", () => {
  test("returns the first successful result without sleeping", async () => {
    const sleeps: number[] = [];
    const result = await withStepRetry(
      "preflight",
      async () => "ok",
      { retries: 2, delaysMs: [10, 20] },
      async (ms) => {
        sleeps.push(ms);
      },
    );
    expect(result).toBe("ok");
    expect(sleeps).toEqual([]);
  });

  test("retries a transient failure then succeeds", async () => {
    const sleeps: number[] = [];
    let attempts = 0;
    const result = await withStepRetry(
      "whitelist",
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("transient");
        return "done";
      },
      { retries: 2, delaysMs: [5, 7] },
      async (ms) => {
        sleeps.push(ms);
      },
    );
    expect(result).toBe("done");
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([5, 7]);
  });

  test("does not retry a lease ownership error", async () => {
    let attempts = 0;
    await expect(
      withStepRetry(
        "publish",
        async () => {
          attempts += 1;
          throw new WorkflowLeaseOwnershipError("lost fence");
        },
        { retries: 3, delaysMs: [1, 1, 1] },
        async () => {},
      ),
    ).rejects.toThrow("lost fence");
    expect(attempts).toBe(1);
  });
});
