import type { NextConfig } from "next";

// Locale routing is path-prefixed via the [lang] segment (en at /en) — no middleware.
// Bare root redirects into the default locale. cacheComponents stays OFF so empty
// generateStaticParams + dynamicParams keep the long tail on-demand (FRONTEND §2.3).
const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: "/", destination: "/en", permanent: false }];
  },
};

export default nextConfig;
