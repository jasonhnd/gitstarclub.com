import type { MetadataRoute } from "next";

// SEO §5 + §11. Indexing stays OFF until launch (private preview; teaser owns the domain).
// Flip SITE_INDEXABLE=1 at launch to allow crawling + advertise the sitemap.
const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gitstarclub.com";
const indexable = process.env.SITE_INDEXABLE === "1";

export default function robots(): MetadataRoute.Robots {
  if (!indexable) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
