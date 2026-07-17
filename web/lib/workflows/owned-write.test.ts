import { afterEach, describe, expect, test } from "bun:test";
import { LEASE_HEARTBEAT_INTERVAL_MS } from "@/lib/workflows/lease";
import { workflowHeartbeat } from "@/lib/workflows/owned-write";

const realNow = Date.now;

afterEach(() => {
  Date.now = realNow;
});

describe("workflowHeartbeat", () => {
  test("coalesces concurrent renewals and renews again at the five-minute bound", async () => {
    let now = 1_000;
    Date.now = () => now;
    let renewals = 0;
    let finishRenewal!: () => void;
    const renewalGate = new Promise<void>((resolve) => {
      finishRenewal = resolve;
    });
    const renew = async () => {
      renewals++;
      if (renewals === 1) await renewalGate;
    };
    const heartbeat = workflowHeartbeat({ runId: "refresh-a", fencingToken: 7 }, renew);

    const first = heartbeat();
    const concurrent = heartbeat();
    expect(renewals).toBe(1);
    finishRenewal();
    await Promise.all([first, concurrent]);

    now += LEASE_HEARTBEAT_INTERVAL_MS - 1;
    await heartbeat();
    expect(renewals).toBe(1);

    now += 1;
    await heartbeat();
    expect(renewals).toBe(2);
  });
});
