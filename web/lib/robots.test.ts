import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import robots from "../app/robots";

const originalSiteIndexable = process.env.SITE_INDEXABLE;
const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

const explicitCrawlerUserAgents = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "anthropic-ai",
  "Google-Extended",
  "Applebot-Extended",
  "Bingbot",
  "CCBot",
] as const;

function restoreEnv(): void {
  if (originalSiteIndexable === undefined) {
    delete process.env.SITE_INDEXABLE;
  } else {
    process.env.SITE_INDEXABLE = originalSiteIndexable;
  }

  if (originalSiteUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  }
}

function rulesFor(result: ReturnType<typeof robots>) {
  if (!result.rules) return [];
  return Array.isArray(result.rules) ? result.rules : [result.rules];
}

describe("robots", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://gitstarclub.test";
  });

  afterEach(() => {
    restoreEnv();
  });

  test("keeps preview fully non-indexable", () => {
    delete process.env.SITE_INDEXABLE;

    expect(robots()).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
  });

  test("lists explicit production crawler rules and preserves /api/ disallow", () => {
    process.env.SITE_INDEXABLE = "1";

    const result = robots();
    const rules = rulesFor(result);

    expect(result.sitemap).toBe("https://gitstarclub.test/sitemap.xml");
    expect(result.host).toBe("https://gitstarclub.test");
    expect(rules.map((rule) => rule.userAgent)).toEqual([
      ...explicitCrawlerUserAgents,
      "*",
    ]);

    for (const userAgent of explicitCrawlerUserAgents) {
      expect(rules).toContainEqual({
        userAgent,
        allow: "/",
        disallow: ["/api/"],
      });
    }

    expect(rules).toContainEqual({
      userAgent: "*",
      allow: "/",
      disallow: ["/api/"],
    });
  });
});
