import { describe, expect, mock, test } from "bun:test";
import type { WorkerEnv } from "../../../workers/gitstarclub-web/src/env";

type WaitUntilContext = { waitUntil(promise: Promise<unknown>): void };

type ForwardedCall = {
  request: Request;
  env: WorkerEnv;
  ctx: WaitUntilContext;
  pending: Promise<unknown>;
};

const forwarded: ForwardedCall[] = [];

mock.module("../../.open-next/worker.js", () => ({
  default: {
    fetch(request: Request, env: WorkerEnv, ctx: WaitUntilContext): Response {
      const pending = Promise.resolve("forwarded");
      forwarded.push({ request, env, ctx, pending });
      ctx.waitUntil(pending);
      return new Response("open-next", { status: 204 });
    },
  },
}));

const nextAppSpecifier = "../../../workers/gitstarclub-web/src/next-app";
const { handleNextRequest } = (await import(nextAppSpecifier)) as {
  handleNextRequest: (
    request: Request,
    env: WorkerEnv,
    ctx: WaitUntilContext,
  ) => Response | Promise<Response>;
};

describe("handleNextRequest", () => {
  test("forwards the same request, env, and waitUntil context to the OpenNext worker", async () => {
    const request = new Request("https://gitstarclub.com/pulse");
    const env = { JOBS: { send: async () => undefined }, MEDIA: null, CRON_SECRET: "cron" } as WorkerEnv;
    const received: Promise<unknown>[] = [];
    const ctx: WaitUntilContext = {
      waitUntil(promise: Promise<unknown>) {
        received.push(promise);
      },
    };

    const response = await handleNextRequest(request, env, ctx);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("open-next");
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].request).toBe(request);
    expect(forwarded[0].env).toBe(env);
    expect(forwarded[0].ctx).toBe(ctx);
    expect(received).toHaveLength(1);
    expect(received[0]).toBe(forwarded[0].pending);
    expect(await received[0]).toBe("forwarded");
  });
});
