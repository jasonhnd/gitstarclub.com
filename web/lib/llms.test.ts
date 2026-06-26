import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { buildLlmsTxt, LLMS_CANONICAL_ORIGIN } from "./llms";

const PUBLIC_LLMS_TXT = new URL("../public/llms.txt", import.meta.url);

function publicLlmsText(): string {
  return readFileSync(PUBLIC_LLMS_TXT, "utf8").replace(/\r\n/g, "\n");
}

function markdownLinks(text: string): string[] {
  return Array.from(text.matchAll(/\]\((https?:\/\/[^)]+)\)/g), (match) => match[1]);
}

describe("llms.txt", () => {
  test("keeps the public root file in sync with the curated static source", () => {
    expect(existsSync(PUBLIC_LLMS_TXT)).toBe(true);
    expect(publicLlmsText()).toBe(buildLlmsTxt());
  });

  test("uses canonical production URLs without duplicating the sitemap", () => {
    const text = publicLlmsText();
    const links = markdownLinks(text);
    const siteLinks = links.filter((url) => url.startsWith(LLMS_CANONICAL_ORIGIN));

    expect(links.length).toBeLessThanOrEqual(12);
    expect(text).not.toContain("sitemap.xml");
    expect(siteLinks).toContain(`${LLMS_CANONICAL_ORIGIN}/`);
    expect(siteLinks).toContain(`${LLMS_CANONICAL_ORIGIN}/rankings`);
    expect(siteLinks).toContain(`${LLMS_CANONICAL_ORIGIN}/categories/language/python`);
    expect(siteLinks).toContain(`${LLMS_CANONICAL_ORIGIN}/about`);
    expect(siteLinks.every((url) => !url.startsWith("https://www.gitstarclub.com"))).toBe(true);
  });
});
