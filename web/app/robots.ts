import type { MetadataRoute } from "next";
import {
  ALLOWED_CRAWLER_USER_AGENTS,
  API_DISALLOW,
  BLOCKED_CRAWLER_USER_AGENTS,
} from "@/lib/robots-policy";

function siteBase(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://gitstarclub.com";
}

export default function robots(): MetadataRoute.Robots {
  const indexable = process.env.SITE_INDEXABLE === "1";
  if (!indexable) return { rules: [{ userAgent: "*", disallow: "/" }] };

  const base = siteBase();
  const publicRules = [
    ...BLOCKED_CRAWLER_USER_AGENTS.map((userAgent) => ({
      userAgent,
      disallow: "/",
    })),
    ...ALLOWED_CRAWLER_USER_AGENTS.map((userAgent) => ({
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
