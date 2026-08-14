import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import robots from "../app/robots";
import { ALLOWED_CRAWLER_USER_AGENTS, BLOCKED_CRAWLER_USER_AGENTS } from "./robots-policy";

const originalSiteIndexable = process.env.SITE_INDEXABLE;
const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

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

  test("blocks cost-amplifying crawlers and keeps retrieval plus search agents", () => {
    process.env.SITE_INDEXABLE = "1";

    const result = robots();
    const rules = rulesFor(result);

    expect(result.sitemap).toBe("https://gitstarclub.test/sitemap.xml");
    expect(result.host).toBe("https://gitstarclub.test");
    expect(rules.map((rule) => rule.userAgent)).toEqual([
      ...BLOCKED_CRAWLER_USER_AGENTS,
      ...ALLOWED_CRAWLER_USER_AGENTS,
      "*",
    ]);

    for (const userAgent of BLOCKED_CRAWLER_USER_AGENTS) {
      expect(rules).toContainEqual({ userAgent, disallow: "/" });
    }
    expect(BLOCKED_CRAWLER_USER_AGENTS).toContain("GPTBot");
    expect(BLOCKED_CRAWLER_USER_AGENTS).toContain("GoogleOther");
    expect(BLOCKED_CRAWLER_USER_AGENTS).toContain("meta-externalagent");
    expect(ALLOWED_CRAWLER_USER_AGENTS).toContain("OAI-SearchBot");
    expect(ALLOWED_CRAWLER_USER_AGENTS).toContain("Bingbot");
    expect(ALLOWED_CRAWLER_USER_AGENTS).not.toContain("GPTBot");

    for (const userAgent of ALLOWED_CRAWLER_USER_AGENTS) {
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
