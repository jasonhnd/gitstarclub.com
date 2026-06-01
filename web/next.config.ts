import type { NextConfig } from "next";

// Canonical URLs do not carry locale prefixes. Language is a cookie-backed in-page
// preference, while repo pages mirror GitHub as /owner/name.
const nextConfig: NextConfig = {};

export default nextConfig;
