import { describe, expect, mock, test } from "bun:test";
import type { WorkerEnv } from "../../../workers/gitstarclub-web/src/env";

type NextFetchCall = { url: string; secret: string | undefined; waited: string[] };

const calls: NextFetchCall[] = [];

mock.module("../../.open-next/worker.js", () => ({
  default: {
    fetch(
      request: Request,
      env: WorkerEnv,
      ctx: { waitUntil(promise: Promise<unknown>): void },
    ): Response {
      const waited: string[] = [];
      ctx.waitUntil(Promise.resolve("forwarded"));
      waited.push("forwarded");
      calls.push({ url: request.url, secret: env.CRON_SECRET, waited });
      return new Response("open-next", { status: 204 });
    },
  },
}));

const nextAppSpecifier = "../../../workers/gitstarclub-web/src/next-app";
const { handleNextRequest } = (await import(nextAppSpecifier)) as {
  handleNextRequest: (
    request: Request,
    env: WorkerEnv,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ) => Response | Promise<Response>;
};

describe("handleNextRequest", () => {
  test("forwards the request, env, and waitUntil context to the OpenNext worker", async () => {
    const env = { JOBS: { send: async () => undefined }, MEDIA: null, CRON_SECRET: "cron" } as WorkerEnv;
    const response = await handleNextRequest(new Request("https://gitstarclub.com/pulse"), env, {
      waitUntil(promise: Promise<unknown>) {
        void promise;
      },
    });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("open-next");
    expect(calls).toEqual([
      { url: "https://gitstarclub.com/pulse", secret: "cron", waited: ["forwarded"] },
    ]);
  });
});
