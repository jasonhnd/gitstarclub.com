import { describe, expect, test } from "bun:test";
import {
  analyticsProvidersForEnvironment,
  assertAnalyticsCspCompatibility,
} from "./analytics-policy";
import { contentSecurityPolicyForEnvironment } from "./csp";
import { getDictionary, LOCALES } from "./i18n";

describe("analyticsProvidersForEnvironment", () => {
  test.each([
    ["unset", {}],
    ["invalid legacy GA ID", { NEXT_PUBLIC_GA_ID: "not-a-measurement-id" }],
    ["valid legacy GA ID", { NEXT_PUBLIC_GA_ID: "G-1234567890" }],
  ])("keeps the %s environment on Vercel Web Analytics only", (_label, environment) => {
    expect(analyticsProvidersForEnvironment(environment)).toEqual([
      "vercel-web-analytics",
    ]);
  });
});

describe("assertAnalyticsCspCompatibility", () => {
  test("accepts the production same-origin policy", () => {
    expect(() =>
      assertAnalyticsCspCompatibility(contentSecurityPolicyForEnvironment("production")),
    ).not.toThrow();
  });

  test.each([
    ["script-src", "default-src 'self'; script-src https://example.com; connect-src 'self'"],
    ["connect-src", "default-src 'self'; script-src 'self'; connect-src https://example.com"],
  ])("rejects a policy that blocks the same-origin %s endpoint", (_directive, csp) => {
    expect(() => assertAnalyticsCspCompatibility(csp)).toThrow("to allow 'self'");
  });

  test("keeps Google tracking origins out of the production policy", () => {
    const csp = contentSecurityPolicyForEnvironment("production");

    expect(csp).not.toContain("googletagmanager.com");
    expect(csp).not.toContain("google-analytics.com");
  });
});

describe("localized privacy contract", () => {
  test("all supported languages name the only analytics provider", async () => {
    for (const locale of LOCALES) {
      const dictionary = await getDictionary(locale);
      expect(dictionary.privacy.analyticsBody).toContain("Vercel Web Analytics");
    }
  });
});
