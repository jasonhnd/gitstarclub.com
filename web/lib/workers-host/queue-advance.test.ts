import { describe, expect, test } from "bun:test";
import {
  QUEUE_ADVANCE_CONSUMER,
  QUEUE_ADVANCE_HEADER,
  isRefreshStepSuccessPayload,
  queueAdvanceFromConsumer,
  successorJobAfterRefreshStep,
} from "./queue-advance";

const foldJob = {
  v: 1 as const,
  graph: "full" as const,
  runId: "refresh-2026-09-20T09-39-26-949Z",
  name: "fold" as const,
  attempt: 0,
  cursor: { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22 },
};

describe("queue advance header", () => {
  test("recognizes the consumer advance header and ignores other values", () => {
    expect(queueAdvanceFromConsumer(new Headers({ [QUEUE_ADVANCE_HEADER]: QUEUE_ADVANCE_CONSUMER }))).toBe(true);
    expect(queueAdvanceFromConsumer(new Headers({ [QUEUE_ADVANCE_HEADER]: " Consumer " }))).toBe(true);
    expect(queueAdvanceFromConsumer(new Headers({ [QUEUE_ADVANCE_HEADER]: "step" }))).toBe(false);
    expect(queueAdvanceFromConsumer(new Headers())).toBe(false);
  });
});

describe("successorJobAfterRefreshStep", () => {
  test("reads the JSON body and walks fold → recomputeRank", async () => {
    const next = await successorJobAfterRefreshStep(
      foldJob,
      Response.json({
        ok: true,
        runId: foldJob.runId,
        step: "fold",
        result: { name: "fold", folded: ["2026-08"], foldedWeeks: [] },
      }),
    );
    expect(next).toMatchObject({
      v: 1,
      graph: "full",
      runId: foldJob.runId,
      name: "recomputeRank",
      attempt: 0,
      cursor: foldJob.cursor,
    });
  });

  test("rejects a header-only 200 so the consumer cannot ack before the body exists", async () => {
    await expect(successorJobAfterRefreshStep(foldJob, new Response("not-json", { status: 200 }))).rejects.toThrow(
      "non-JSON body",
    );
  });

  test("fails closed on HTTP errors and result-less payloads", async () => {
    await expect(successorJobAfterRefreshStep(foldJob, new Response("nope", { status: 503 }))).rejects.toThrow(
      "HTTP 503",
    );
    await expect(successorJobAfterRefreshStep(foldJob, Response.json({ ok: true }))).rejects.toThrow("result-less");
    expect(isRefreshStepSuccessPayload({ ok: true, result: { name: "fold" } })).toBe(true);
    expect(isRefreshStepSuccessPayload({ ok: false, result: { name: "fold" } })).toBe(false);
  });

  test("returns null at the end of the graph", async () => {
    const next = await successorJobAfterRefreshStep(
      { ...foldJob, name: "markPublished" as const },
      Response.json({ ok: true, result: { name: "markPublished", ok: true } }),
    );
    expect(next).toBeNull();
  });
});
