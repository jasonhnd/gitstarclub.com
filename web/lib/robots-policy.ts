export const API_DISALLOW = "/api/";

/** Retrieval and user-triggered agents that can cite the site. */
export const ALLOWED_CRAWLER_USER_AGENTS = [
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
] as const;

/**
 * Bulk / training / SEO scrapers that drove the 2026-08 cost spike.
 * Googlebot remains allowed via the `*` allow rule; GoogleOther is blocked here.
 */
export const BLOCKED_CRAWLER_USER_AGENTS = [
  "GPTBot",
  "GoogleOther",
  "meta-externalagent",
  "FacebookBot",
  "AhrefsBot",
  "Amazonbot",
  "PetalBot",
  "Bytespider",
  "SemrushBot",
  "DotBot",
  "CCBot",
] as const;
