import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { contentSecurityPolicyForEnvironment, THEME_INIT_SCRIPT_CSP_HASH } from "./csp";
import { stringifyJsonForScript } from "./json-script";
import { hasValidBearerToken, requireBearerToken } from "./security";
import { THEME_INIT_SCRIPT } from "./theme-script";

function cspDirective(csp: string, name: string): string {
  return csp.split("; ").find((directive) => directive.startsWith(`${name} `)) ?? "";
}

describe("contentSecurityPolicyForEnvironment", () => {
  test("does not allow broad inline scripts in production", () => {
    const csp = contentSecurityPolicyForEnvironment("production");
    const scriptSrc = cspDirective(csp, "script-src");

    expect(scriptSrc).toBe(`script-src 'self' ${THEME_INIT_SCRIPT_CSP_HASH}`);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  test("ties the production script hash to the rendered theme initializer", () => {
    const expectedHash = `'sha256-${createHash("sha256").update(THEME_INIT_SCRIPT).digest("base64")}'`;

    expect(THEME_INIT_SCRIPT_CSP_HASH).toBe(expectedHash);
  });

  test("keeps development script allowances scoped to development", () => {
    const csp = contentSecurityPolicyForEnvironment("development");
    const scriptSrc = cspDirective(csp, "script-src");

    expect(scriptSrc).toBe("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  test("does not include eval allowances outside development", () => {
    const scriptSrc = cspDirective(contentSecurityPolicyForEnvironment("test"), "script-src");

    expect(scriptSrc).toBe("script-src 'self' 'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });
});

describe("stringifyJsonForScript", () => {
  test("escapes script-breaking and HTML-sensitive characters", () => {
    const json = stringifyJsonForScript({
      description: '</script><script>alert("x")</script>&',
      line: "a\u2028b\u2029c",
    });

    expect(json).not.toContain("</script>");
    expect(json).not.toContain("<script>");
    expect(json).toContain("\\u003c/script\\u003e\\u003cscript\\u003e");
    expect(json).toContain("\\u0026");
    expect(json).toContain("\\u2028");
    expect(json).toContain("\\u2029");
    expect(JSON.parse(json)).toEqual({
      description: '</script><script>alert("x")</script>&',
      line: "a\u2028b\u2029c",
    });
  });
});

describe("hasValidBearerToken", () => {
  test("accepts an exact bearer token match", () => {
    expect(hasValidBearerToken("Bearer secret-value", "secret-value")).toBe(true);
  });

  test("rejects missing, malformed, and unequal bearer tokens", () => {
    expect(hasValidBearerToken(null, "secret-value")).toBe(false);
    expect(hasValidBearerToken("Basic secret-value", "secret-value")).toBe(false);
    expect(hasValidBearerToken("Bearer secret-value-extra", "secret-value")).toBe(false);
    expect(hasValidBearerToken("Bearer wrong-value", "secret-value")).toBe(false);
    expect(hasValidBearerToken("Bearer secret-value", "")).toBe(false);
  });
});

describe("requireBearerToken", () => {
  test("returns null for authorized cron/workflow route requests", () => {
    expect(requireBearerToken("Bearer secret-value", "secret-value")).toBeNull();
  });

  test("returns 401 for missing, invalid, or unconfigured secrets", () => {
    expect(requireBearerToken(null, "secret-value")?.status).toBe(401);
    expect(requireBearerToken("Bearer wrong-value", "secret-value")?.status).toBe(401);
    expect(requireBearerToken("Bearer secret-value", "")?.status).toBe(401);
  });
});
