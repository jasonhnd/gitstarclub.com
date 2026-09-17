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

  test("disables Vercel Web Analytics on the CF Workers preview host", () => {
    expect(analyticsProvidersForEnvironment({ HOSTING_TARGET: "cf" })).toEqual([]);
    expect(
      analyticsProvidersForEnvironment({ NEXT_PUBLIC_HOSTING_TARGET: "cf", NEXT_PUBLIC_GA_ID: "G-1234567890" }),
    ).toEqual([]);
  });

  test("keeps Vercel Web Analytics on Vercel production if HOSTING_TARGET is mis-set", () => {
    expect(
      analyticsProvidersForEnvironment({ HOSTING_TARGET: "cf", VERCEL_ENV: "production" }),
    ).toEqual(["vercel-web-analytics"]);
  });
});

describe("assertAnalyticsCspCompatibility", () => {
  test("accepts the production same-origin policy", () => {
    expect(() =>
      assertAnalyticsCspCompatibility(contentSecurityPolicyForEnvironment("production")),
    ).not.toThrow();
  });

  test("skips the Vercel insights CSP check on the CF Workers host", () => {
    expect(() =>
      assertAnalyticsCspCompatibility("default-src 'none'; script-src 'none'; connect-src 'none'", {
        HOSTING_TARGET: "cf",
      }),
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
