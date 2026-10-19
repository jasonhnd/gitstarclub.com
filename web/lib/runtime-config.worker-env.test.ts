import { describe, expect, mock, test } from "bun:test";
import { isProductionDeployment } from "./runtime-config";

// Bun module mocks are process-global. This is the only suite that mocks
// `@opennextjs/cloudflare`. `bun test --isolate` keeps
// that mock out of `runtime-config.test.ts`.
describe("Worker runtime env", () => {
  test("isProductionDeployment sees DEPLOY_ENV from the live Worker env", () => {
    const previous = process.env.DEPLOY_ENV;
    delete process.env.DEPLOY_ENV;
    mock.module("@opennextjs/cloudflare", () => ({
      getCloudflareContext: () => ({
        env: { DEPLOY_ENV: "production", JOBS: { send: async () => {} } },
      }),
    }));
    try {
      expect(isProductionDeployment()).toBe(true);
      expect(isProductionDeployment({})).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.DEPLOY_ENV;
      else process.env.DEPLOY_ENV = previous;
    }
  });
});
