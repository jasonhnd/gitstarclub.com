import { expect, test } from "bun:test";
import { astroHostWorker } from "../cloudflare.config";
import { hostWorker } from "../../web/cloudflare.config";
import { secureResponse } from "../src/lib/host";

test("both Astro modes preserve existing resources, vars, queue policy and compatibility", () => {
  for (const mode of ["pre", "production"]) {
    const expected = hostWorker(mode);
    const actual = astroHostWorker(mode);
    expect(actual.env).toEqual(expected.env);
    expect(actual.triggers).toEqual(expected.triggers);
    expect(actual.name).toBe(expected.name);
    expect(actual.compatibilityFlags).toEqual(expected.compatibilityFlags);
    expect(actual.entrypoint).toBe("src/worker.ts");
    expect(actual.triggers?.every((trigger) => trigger.type === "queue")).toBe(true);
  }
  expect(() => astroHostWorker("development")).toThrow("explicit mode");
});

test("production removes noindex while pre blocks indexing, preserving the exact CSP", () => {
  for (const indexable of [false, true]) {
    const response = secureResponse(new Response("page"), "GET", "MISS", false, indexable);
    expect(response.headers.get("x-robots-tag")).toBe(indexable ? null : "noindex, nofollow");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self' 'unsafe-inline'");
    expect(response.headers.get("content-security-policy")).not.toContain("unsafe-eval");
  }
});
