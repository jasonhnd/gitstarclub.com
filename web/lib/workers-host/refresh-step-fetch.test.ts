import { describe, expect, test } from "bun:test";
import { fetchRefreshStep, refreshStepFetchVia } from "./refresh-step-fetch";

const STEP = "https://pre.gitstarclub.com/api/workflows/refresh/step";

describe("refresh step fetch", () => {
  test("prefers WORKER_SELF_REFERENCE so the Queue consumer skips the public 524 hop", async () => {
    const calls: string[] = [];
    const env = {
      REFRESH_STEP_URL: STEP,
      CRON_SECRET: "secret",
      WORKER_SELF_REFERENCE: {
        async fetch(request: Request) {
          calls.push(`self:${request.method}:${request.url}:${request.headers.get("authorization")}`);
          expect(await request.json()).toEqual({ name: "whitelist" });
          return new Response("ok", { status: 200 });
        },
      },
    };
    const fetchImpl = async () => {
      calls.push("public");
      return new Response("nope", { status: 524 });
    };

    expect(refreshStepFetchVia(env)).toBe("self-reference");
    const response = await fetchRefreshStep(env, { name: "whitelist" }, fetchImpl);
    expect(response.status).toBe(200);
    expect(calls).toEqual(["self:POST:https://pre.gitstarclub.com/api/workflows/refresh/step:Bearer secret"]);
  });

  test("falls back to public fetch when the self-reference binding is missing", async () => {
    const env = { REFRESH_STEP_URL: STEP, CRON_SECRET: "secret" };
    expect(refreshStepFetchVia(env)).toBe("public");
    const response = await fetchRefreshStep(env, { name: "preflight" }, async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      expect(request.cache).toBe("no-store");
      expect(request.url).toBe(STEP);
      return new Response("queued", { status: 200 });
    });
    expect(response.status).toBe(200);
  });

  test("fails closed without the step URL or secret", async () => {
    await expect(fetchRefreshStep({}, { name: "whitelist" })).rejects.toThrow(
      "REFRESH_STEP_URL and CRON_SECRET are required to consume a refresh step",
    );
  });
});
