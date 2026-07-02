export type AiCrawlerFamily =
  | "GPTBot"
  | "OAI-SearchBot"
  | "ChatGPT-User"
  | "PerplexityBot"
  | "Perplexity-User"
  | "ClaudeBot"
  | "Claude-SearchBot"
  | "anthropic-ai"
  | "Google-Extended"
  | "Applebot"
  | "Applebot-Extended"
  | "Bingbot"
  | "CCBot";

export type AiReferrerHost =
  | "chatgpt.com"
  | "chat.openai.com"
  | "perplexity.ai"
  | "gemini.google.com"
  | "google.com"
  | "copilot.microsoft.com"
  | "claude.ai"
  | "grok.com"
  | "x.com";

export type GeoPathFamily =
  | "repo"
  | "org"
  | "rankings"
  | "category"
  | "pulse"
  | "compare"
  | "about"
  | "data-export"
  | "other";

export type ReportGrain = "day" | "week";

export type AiCrawlerTaxonomyEntry = {
  family: AiCrawlerFamily;
  patterns: readonly string[];
};

export type AiReferrerTaxonomyEntry = {
  host: AiReferrerHost;
  match: "host" | "host-or-subdomain" | "google-ai-surface";
};

export type AiCrawlerCount = {
  date: string;
  user_agent_family: AiCrawlerFamily;
  path_family: GeoPathFamily;
  status_bucket: string;
  count: number;
};

export type AiReferrerCount = {
  date: string;
  referrer_host: AiReferrerHost;
  path_family: GeoPathFamily;
  count: number;
};

export type AiLogReport = {
  grain: ReportGrain;
  input_records: number;
  skipped_records: number;
  crawler_counts: AiCrawlerCount[];
  referrer_counts: AiReferrerCount[];
  taxonomy: {
    crawler_user_agents: AiCrawlerTaxonomyEntry[];
    ai_referrers: AiReferrerTaxonomyEntry[];
    path_families: readonly GeoPathFamily[];
  };
};

type RawRecord = Record<string, unknown>;

type NormalizedRequestLog = {
  timestamp?: unknown;
  userAgents: string[];
  referrer?: string;
  path?: string;
  statusCode?: unknown;
};

export const AI_CRAWLER_USER_AGENT_TAXONOMY: readonly AiCrawlerTaxonomyEntry[] = [
  { family: "GPTBot", patterns: ["GPTBot"] },
  { family: "OAI-SearchBot", patterns: ["OAI-SearchBot"] },
  { family: "ChatGPT-User", patterns: ["ChatGPT-User"] },
  { family: "PerplexityBot", patterns: ["PerplexityBot"] },
  { family: "Perplexity-User", patterns: ["Perplexity-User"] },
  { family: "ClaudeBot", patterns: ["ClaudeBot"] },
  { family: "Claude-SearchBot", patterns: ["Claude-SearchBot"] },
  { family: "anthropic-ai", patterns: ["anthropic-ai"] },
  { family: "Google-Extended", patterns: ["Google-Extended"] },
  { family: "Applebot-Extended", patterns: ["Applebot-Extended"] },
  { family: "Applebot", patterns: ["Applebot"] },
  { family: "Bingbot", patterns: ["Bingbot", "bingbot"] },
  { family: "CCBot", patterns: ["CCBot"] },
] as const;

export const AI_REFERRER_TAXONOMY: readonly AiReferrerTaxonomyEntry[] = [
  { host: "chatgpt.com", match: "host-or-subdomain" },
  { host: "chat.openai.com", match: "host" },
  { host: "perplexity.ai", match: "host-or-subdomain" },
  { host: "gemini.google.com", match: "host" },
  { host: "google.com", match: "google-ai-surface" },
  { host: "copilot.microsoft.com", match: "host" },
  { host: "claude.ai", match: "host-or-subdomain" },
  { host: "grok.com", match: "host-or-subdomain" },
  { host: "x.com", match: "host-or-subdomain" },
] as const;

export const GEO_PATH_FAMILIES: readonly GeoPathFamily[] = [
  "repo",
  "org",
  "rankings",
  "category",
  "pulse",
  "compare",
  "about",
  "data-export",
  "other",
] as const;

export function buildAiLogReport(input: string, options: { grain?: ReportGrain } = {}): AiLogReport {
  const grain = options.grain ?? "day";
  const parsed = parseLogRecords(input);
  const crawlerCounts = new Map<string, AiCrawlerCount>();
  const referrerCounts = new Map<string, AiReferrerCount>();

  for (const record of parsed.records) {
    const request = normalizeRequestLog(record);
    const date = periodKey(request.timestamp, grain);
    const pathFamily = classifyPathFamily(request.path);
    const statusBucket = statusBucketFor(request.statusCode);
    const crawlerFamily = classifyCrawlerUserAgent(request.userAgents);
    const referrerHost = classifyAiReferrer(request.referrer);

    if (crawlerFamily) {
      const key = [date, crawlerFamily, pathFamily, statusBucket].join("|");
      const current =
        crawlerCounts.get(key) ??
        ({
          date,
          user_agent_family: crawlerFamily,
          path_family: pathFamily,
          status_bucket: statusBucket,
          count: 0,
        } satisfies AiCrawlerCount);
      current.count += 1;
      crawlerCounts.set(key, current);
    }

    if (referrerHost) {
      const key = [date, referrerHost, pathFamily].join("|");
      const current =
        referrerCounts.get(key) ??
        ({
          date,
          referrer_host: referrerHost,
          path_family: pathFamily,
          count: 0,
        } satisfies AiReferrerCount);
      current.count += 1;
      referrerCounts.set(key, current);
    }
  }

  return {
    grain,
    input_records: parsed.records.length,
    skipped_records: parsed.skipped,
    crawler_counts: sortCounts([...crawlerCounts.values()], crawlerSortKey),
    referrer_counts: sortCounts([...referrerCounts.values()], referrerSortKey),
    taxonomy: {
      crawler_user_agents: [...AI_CRAWLER_USER_AGENT_TAXONOMY],
      ai_referrers: [...AI_REFERRER_TAXONOMY],
      path_families: GEO_PATH_FAMILIES,
    },
  };
}

export function formatAiLogReportMarkdown(report: AiLogReport): string {
  const lines = [
    "# GitStarClub AI Crawler and Referrer Report",
    "",
    `Grain: ${report.grain}`,
    `Input log records: ${report.input_records}`,
    `Skipped log records: ${report.skipped_records}`,
    "",
    "## AI crawler user-agent counts",
    "",
  ];

  if (report.crawler_counts.length === 0) {
    lines.push("No matching AI crawler user-agent hits.", "");
  } else {
    lines.push("| date | user_agent_family | path_family | status_bucket | count |");
    lines.push("|---|---|---|---|---:|");
    for (const row of report.crawler_counts) {
      lines.push(
        `| ${row.date} | ${row.user_agent_family} | ${row.path_family} | ${row.status_bucket} | ${row.count} |`,
      );
    }
    lines.push("");
  }

  lines.push("## AI referrer counts", "");
  if (report.referrer_counts.length === 0) {
    lines.push("No matching AI referrer hits.", "");
  } else {
    lines.push("| date | referrer_host | path_family | count |");
    lines.push("|---|---|---|---:|");
    for (const row of report.referrer_counts) {
      lines.push(`| ${row.date} | ${row.referrer_host} | ${row.path_family} | ${row.count} |`);
    }
    lines.push("");
  }

  lines.push("## Taxonomy", "");
  lines.push(`Crawler user-agents: ${AI_CRAWLER_USER_AGENT_TAXONOMY.map((entry) => entry.family).join(", ")}`);
  lines.push(`AI referrers: ${AI_REFERRER_TAXONOMY.map((entry) => entry.host).join(", ")}`);
  lines.push(`Path families: ${GEO_PATH_FAMILIES.join(", ")}`);

  return `${lines.join("\n").trimEnd()}\n`;
}

function parseLogRecords(input: string): { records: RawRecord[]; skipped: number } {
  const trimmed = input.trim();
  if (!trimmed) return { records: [], skipped: 0 };

  try {
    const parsed = JSON.parse(trimmed);
    return { records: collectRecords(parsed), skipped: 0 };
  } catch {
    const records: RawRecord[] = [];
    let skipped = 0;

    for (const line of trimmed.split(/\r?\n/)) {
      const candidate = line.trim();
      if (!candidate) continue;
      try {
        records.push(...collectRecords(JSON.parse(candidate)));
      } catch {
        skipped += 1;
      }
    }

    return { records, skipped };
  }
}

function collectRecords(value: unknown): RawRecord[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectRecords(item));
  if (!isRecord(value)) return [];

  const batched = firstArray(value, ["logs", "events", "data"]);
  if (batched) return batched.flatMap((item) => collectRecords(item));

  return [value];
}

function normalizeRequestLog(record: RawRecord): NormalizedRequestLog {
  const proxy = readRecord(record, "proxy");
  const request = readRecord(record, "request");
  const httpRequest = readRecord(record, "httpRequest");
  const headers = readRecord(record, "headers") ?? readRecord(request, "headers");

  return {
    timestamp: firstKnown(proxy, ["timestamp"]) ?? firstKnown(record, ["timestamp", "time", "datetime", "date"]),
    userAgents: collectStrings(
      firstKnown(proxy, ["userAgent", "userAgents", "user_agent"]) ??
        firstKnown(record, ["userAgent", "userAgents", "user_agent", "requestUserAgent", "request_user_agent", "ua"]) ??
        firstKnown(request, ["userAgent", "user_agent"]) ??
        firstKnown(httpRequest, ["userAgent", "user_agent"]) ??
        firstKnown(headers, ["user-agent", "User-Agent", "userAgent"]),
    ),
    referrer: firstString(
      firstKnown(proxy, ["referer", "referrer"]) ??
        firstKnown(record, ["referer", "referrer", "requestReferer", "requestReferrer", "request_referrer"]) ??
        firstKnown(request, ["referer", "referrer"]) ??
        firstKnown(httpRequest, ["referer", "referrer"]) ??
        firstKnown(headers, ["referer", "referrer", "Referer", "Referrer"]),
    ),
    path: firstString(
      firstKnown(proxy, ["path"]) ??
        firstKnown(record, ["path", "requestPath", "request_path", "url", "requestUrl", "request_url"]) ??
        firstKnown(request, ["path", "url"]) ??
        firstKnown(httpRequest, ["requestUrl", "url"]),
    ),
    statusCode:
      firstKnown(proxy, ["statusCode", "status"]) ??
      firstKnown(record, ["statusCode", "status", "status_code"]) ??
      firstKnown(httpRequest, ["status", "statusCode"]),
  };
}

function classifyCrawlerUserAgent(userAgents: string[]): AiCrawlerFamily | undefined {
  for (const userAgent of userAgents) {
    for (const entry of AI_CRAWLER_USER_AGENT_TAXONOMY) {
      if (entry.patterns.some((pattern) => userAgent.includes(pattern))) return entry.family;
    }
  }
  return undefined;
}

function classifyAiReferrer(referrer: string | undefined): AiReferrerHost | undefined {
  if (!referrer) return undefined;
  const host = normalizeHost(referrer);
  if (!host) return undefined;

  if (host === "chat.openai.com") return "chat.openai.com";
  if (host === "gemini.google.com") return "gemini.google.com";
  if (host === "copilot.microsoft.com") return "copilot.microsoft.com";
  if (host === "google.com" && looksLikeGoogleAiSurface(referrer)) return "google.com";

  for (const entry of AI_REFERRER_TAXONOMY) {
    if (entry.match !== "host-or-subdomain") continue;
    if (host === entry.host || host.endsWith(`.${entry.host}`)) return entry.host;
  }

  return undefined;
}

function looksLikeGoogleAiSurface(referrer: string): boolean {
  const lower = referrer.toLowerCase();
  return (
    lower.includes("udm=50") ||
    lower.includes("ai_overview") ||
    lower.includes("aio") ||
    lower.includes("ai+overview") ||
    lower.includes("ai%20overview") ||
    lower.includes("ai+mode") ||
    lower.includes("ai%20mode")
  );
}

function classifyPathFamily(rawPath: string | undefined): GeoPathFamily {
  const path = normalizePath(rawPath);
  if (path.startsWith("/o/")) return "org";
  if (path === "/rankings" || path.startsWith("/rankings/")) return "rankings";
  if (path === "/categories" || path.startsWith("/categories/")) return "category";
  if (path === "/pulse" || path.startsWith("/pulse/")) return "pulse";
  if (path === "/compare" || path.startsWith("/compare/")) return "compare";
  if (path === "/about" || path.startsWith("/about/")) return "about";
  if (path.startsWith("/data/exports/")) return "data-export";
  if (/^\/[^/?#]+\/[^/?#]+\/?$/.test(path)) return "repo";
  return "other";
}

function normalizePath(rawPath: string | undefined): string {
  if (!rawPath) return "/";
  try {
    const url = rawPath.startsWith("http://") || rawPath.startsWith("https://")
      ? new URL(rawPath)
      : new URL(rawPath, "https://gitstarclub.com");
    return url.pathname || "/";
  } catch {
    return rawPath.split(/[?#]/, 1)[0] || "/";
  }
}

function normalizeHost(rawReferrer: string): string | undefined {
  const value = rawReferrer.trim();
  if (!value) return undefined;

  try {
    const url = value.startsWith("http://") || value.startsWith("https://") ? new URL(value) : new URL(`https://${value}`);
    return stripHost(url.hostname);
  } catch {
    return stripHost(value.split(/[/?#]/, 1)[0]);
  }
}

function stripHost(host: string): string | undefined {
  const normalized = host.trim().toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
  if (!normalized) return undefined;
  return normalized.startsWith("www.") ? normalized.slice("www.".length) : normalized;
}

function periodKey(timestamp: unknown, grain: ReportGrain): string {
  const date = dateFromTimestamp(timestamp);
  if (!date) return "unknown";
  if (grain === "week") return isoWeekKey(date);
  return date.toISOString().slice(0, 10);
}

function dateFromTimestamp(timestamp: unknown): Date | undefined {
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    const millis = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof timestamp === "string" && timestamp.trim()) {
    const numeric = Number(timestamp);
    if (Number.isFinite(numeric)) return dateFromTimestamp(numeric);
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
}

function isoWeekKey(date: Date): string {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const isoYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((utcDate.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function statusBucketFor(statusCode: unknown): string {
  const status = typeof statusCode === "string" ? Number(statusCode) : statusCode;
  if (typeof status !== "number" || !Number.isFinite(status) || status < 100) return "unknown";
  return `${Math.floor(status / 100)}xx`;
}

function firstArray(record: RawRecord, keys: string[]): unknown[] | undefined {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return undefined;
}

function readRecord(record: RawRecord | undefined, key: string): RawRecord | undefined {
  if (!record) return undefined;
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function firstKnown(record: RawRecord | undefined, keys: string[]): unknown {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (Array.isArray(value)) {
    return value.find((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  return undefined;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string" && value.trim().length > 0) return [value];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  return [];
}

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortCounts<T>(counts: T[], keyFor: (item: T) => string): T[] {
  return counts.sort((a, b) => keyFor(a).localeCompare(keyFor(b)));
}

function crawlerSortKey(row: AiCrawlerCount): string {
  return [row.date, row.user_agent_family, row.path_family, row.status_bucket].join("|");
}

function referrerSortKey(row: AiReferrerCount): string {
  return [row.date, row.referrer_host, row.path_family].join("|");
}
