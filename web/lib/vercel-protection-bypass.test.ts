import { describe, expect, test } from "bun:test";
import { vercelProtectionBypassHeaders } from "./vercel-protection-bypass";

describe("vercelProtectionBypassHeaders", () => {
  test("returns nothing when the automation secret is absent", () => {
    expect(vercelProtectionBypassHeaders({})).toEqual({});
    expect(vercelProtectionBypassHeaders({ VERCEL_AUTOMATION_BYPASS_SECRET: "  " })).toEqual({});
  });

  test("sends the bypass header and cookie flag when the secret is set", () => {
    expect(vercelProtectionBypassHeaders({ VERCEL_AUTOMATION_BYPASS_SECRET: " tok " })).toEqual({
      "x-vercel-protection-bypass": "tok",
      "x-vercel-set-bypass-cookie": "true",
    });
  });
});
