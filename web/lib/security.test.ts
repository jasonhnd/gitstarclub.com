import { describe, expect, test } from "bun:test";
import { stringifyJsonForScript } from "./json-script";
import { THEME_INIT_SCRIPT } from "./theme-script";
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  googleAnalyticsInitScript,
  hasValidBearerToken,
  requireBearerToken,
  safeExternalHref,
  sha256CspHash,
} from "./security";

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

describe("safeExternalHref", () => {
  test("allows only http(s) external hrefs", () => {
    expect(safeExternalHref("https://example.com/project")).toBe("https://example.com/project");
    expect(safeExternalHref("http://example.com/project")).toBe("http://example.com/project");
    expect(safeExternalHref("")).toBeNull();
    expect(safeExternalHref(null)).toBeNull();
    for (const value of ["javascript:alert(1)", "data:text/html,hi", "file:///tmp/repo", "ftp://example.com/repo", "/relative"]) {
      expect(safeExternalHref(value)).toBeNull();
    }
  });
});

describe("Content Security Policy", () => {
  test("production script-src omits broad unsafe-inline and allows only the theme hash plus approved script origins", () => {
    const csp = buildContentSecurityPolicy({ isProduction: true, googleAnalyticsId: "G-ABC123" });
    const scriptSrc = csp.split("; ").find((part) => part.startsWith("script-src ")) ?? "";

    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).toContain(sha256CspHash(THEME_INIT_SCRIPT));
    expect(scriptSrc).toContain(sha256CspHash(googleAnalyticsInitScript("G-ABC123")));
    expect(scriptSrc).toContain("https://www.googletagmanager.com");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  test("development CSP keeps React debugging allowances out of production only", () => {
    const csp = buildContentSecurityPolicy({ isProduction: false });
    const scriptSrc = csp.split("; ").find((part) => part.startsWith("script-src ")) ?? "";

    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  test("security headers include the generated CSP header", () => {
    expect(buildSecurityHeaders({ isProduction: true })).toContainEqual({
      key: "Content-Security-Policy",
      value: buildContentSecurityPolicy({ isProduction: true }),
    });
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
