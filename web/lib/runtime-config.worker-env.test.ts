import { describe, expect, test } from "bun:test";
import { isProductionDeployment } from "./runtime-config";
import { withWorkerEnv } from "./workers-host/runtime-env";

describe("Worker runtime env", () => {
  test("deployment selection reads the request-scoped binding", () => withWorkerEnv({ DEPLOY_ENV: "production" }, () => {
    expect(isProductionDeployment()).toBe(true);
    expect(isProductionDeployment({})).toBe(false);
  }));
});
