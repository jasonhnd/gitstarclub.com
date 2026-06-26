import type { MetadataRoute } from "next";

// SEO §5 + §11. Indexing stays OFF until launch (private preview; teaser owns the domain).
// Flip SITE_INDEXABLE=1 at launch to allow crawling + advertise the sitemap.
const API_DISALLOW = "/api/";
const EXPLICIT_CRAWLER_USER_AGENTS = [
  // GEO §8.1: retrieval, search, and training crawler access is explicit.
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

function siteBase(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://gitstarclub.com";
}

export default function robots(): MetadataRoute.Robots {
  const indexable = process.env.SITE_INDEXABLE === "1";
  if (!indexable) return { rules: [{ userAgent: "*", disallow: "/" }] };

  const base = siteBase();
  const publicRules = [
    ...EXPLICIT_CRAWLER_USER_AGENTS.map((userAgent) => ({
      userAgent,
      allow: "/",
      disallow: [API_DISALLOW],
    })),
    { userAgent: "*", allow: "/", disallow: [API_DISALLOW] },
  ];

  return {
    rules: publicRules,
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
