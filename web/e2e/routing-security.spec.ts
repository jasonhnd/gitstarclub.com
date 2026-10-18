import { expect, test } from "@playwright/test";

const NOT_FOUND_TITLES = {
  en: "Page not found",
  ja: "ページが見つかりません",
  zh: "找不到页面",
  "zh-TW": "找不到頁面",
  ko: "페이지를 찾을 수 없습니다",
  es: "Página no encontrada",
  fr: "Page introuvable",
} as const;

for (const locale of Object.keys(NOT_FOUND_TITLES)) {
  test(`${locale} privacy has no analytics provider or tracking requests`, async ({ page }) => {
    const trackingRequests: string[] = [];
    page.on("request", (request) => {
      if (/google-analytics\.com|googletagmanager\.com|\/_vercel\/(?:insights|speed-insights)|vercel-insights\.com/.test(request.url())) {
        trackingRequests.push(request.url());
      }
    });

    const prefix = locale === "en" ? "" : `/${locale}`;
    const response = await page.goto(`${prefix}/privacy`, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    const csp = response?.headers()["content-security-policy"] ?? "";

    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("googletagmanager.com");
    expect(csp).not.toContain("google-analytics.com");
    await expect(page.locator("main")).not.toContainText(/Vercel|Web Analytics/i);
    await expect(page.locator('meta[name="description"]')).not.toHaveAttribute("content", /Vercel|Web Analytics/i);
    await expect(page.locator('script[src*="/_vercel/insights"], script[src*="vercel-insights.com"]')).toHaveCount(0);
    expect(trackingRequests).toEqual([]);
  });
}

test("the language endpoint never redirects cross-origin", async ({ request, baseURL }) => {
  const response = await request.get(
    `${baseURL}/api/lang?lang=en&next=/%5C%5Cexample.com/path`,
    { maxRedirects: 0 },
  );

  expect(response.status()).toBe(307);
  const location = new URL(response.headers().location, baseURL);
  expect(location.protocol).toBe(new URL(baseURL as string).protocol);
  expect(location.port).toBe(new URL(baseURL as string).port);
  expect(location.hostname).not.toBe("example.com");
  expect(location.pathname).toBe("/");
});

test("dotted repository slugs honor the locale cookie while public assets do not", async ({ context, page, baseURL }) => {
  await context.addCookies([
    {
      name: "gsc_lang",
      value: "ja",
      url: baseURL,
    },
  ]);

  await page.goto("/mrdoob/three.js");
  expect(new URL(page.url()).pathname).toBe("/ja/mrdoob/three.js");

  const favicon = await context.request.get("/favicon.svg", {
    headers: { accept: "text/html" },
    maxRedirects: 0,
  });
  expect(favicon.status()).toBe(200);
  expect(favicon.headers().location).toBeUndefined();
});

for (const [locale, title] of Object.entries(NOT_FOUND_TITLES)) {
  test(`${locale} missing pages retain a localized 404`, async ({ page }) => {
    const prefix = locale === "en" ? "" : `/${locale}`;
    const response = await page.goto(`${prefix}/definitely-missing-owner/definitely-missing-repository`);

    expect(response?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("lang", locale === "zh" ? "zh-CN" : locale);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/i);
  });
}
