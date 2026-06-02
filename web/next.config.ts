import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

// Canonical URLs do not carry locale prefixes. Language is a cookie-backed in-page
// preference, while repo pages mirror GitHub as /owner/name.
const nextConfig: NextConfig = {};

// withWorkflow enables the "use workflow" / "use step" directives (Vercel Workflow SDK).
export default withWorkflow(nextConfig);
