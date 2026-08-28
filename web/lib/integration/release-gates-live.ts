import { LiveGenerationPointer, SearchIndex } from "@/lib/contracts";
import { vercelProtectionBypassHeaders } from "@/lib/vercel-protection-bypass";
import {
  resolveLiveArtifactFromHistory,
  type LiveArtifactResolution,
} from "@/lib/data/live-generation-history";

// Live product release gates for #286.
// These checks hit a real deployment URL + the public Blob store. They are meant
// to fail closed when RELEASE_GATE_REQUIRE_LIVE=1 (CI product-gates job).
//
// Week/period math is intentionally local (not imported from @/lib/periods) so
// full-suite runs cannot be poisoned by mock.module("@/lib/periods") leaks from
// other test files (e.g. uiux-seo / watermark).

/** Production public Blob base (not a secret — store is public-read). Overridable. */
export const DEFAULT_PUBLIC_BLOB_BASE = "https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com";

/**
 * Live weeks known to be missing after the 2026-06-30 token outage window.
 * Empty after the 2026-W27 GH Archive WatchEvent backfill (see docs/OPS.md).
 * Re-add only if a verified hole reappears.
 */
export const KNOWN_MISSING_LIVE_WEEKS = [] as const;

export const SYNC_RUN_MAX_AGE_MS = 4 * 24 * 60 * 60 * 1000;
export const BASE_PUBLISH_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const EXPORT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const SEARCH_MIN_REPOS = 1000;
export const REQUEST_TIMEOUT_MS = 30_000;

export type GateFinding = {
  id: string;
  ok: boolean;
  summary: string;
  observed?: Record<string, string | number | boolean | null>;
};

export type LiveGateConfig = {
  siteBase: string;
  blobBase: string;
  now?: Date;
  knownMissingWeeks?: readonly string[];
};

export type GateEnv = Record<string, string | undefined>;

export function resolveLiveGateConfig(env: GateEnv = process.env): LiveGateConfig | { error: string } {
  const siteBase = (env.RELEASE_GATE_SITE ?? env.SEO_LIVE_BASE ?? env.LIVE_SMOKE_SITE_URL ?? "").replace(/\/+$/, "");
  const blobBase = (env.RELEASE_GATE_BLOB_BASE ?? env.BLOB_BASE_URL ?? DEFAULT_PUBLIC_BLOB_BASE).replace(/\/+$/, "");
  if (!siteBase) {
    return { error: "RELEASE_GATE_SITE (or SEO_LIVE_BASE) is required for live product gates" };
  }
  if (!blobBase || blobBase.includes("blob.example.com") || blobBase.includes("127.0.0.1")) {
    return { error: `RELEASE_GATE_BLOB_BASE must be a real public Blob base, got ${blobBase || "(empty)"}` };
  }
  return { siteBase, blobBase };
}

export function liveGatesRequired(env: GateEnv = process.env): boolean {
  return env.RELEASE_GATE_REQUIRE_LIVE === "1" || env.RELEASE_GATE_REQUIRE_LIVE === "true";
}

async function fetchText(url: string): Promise<{ status: number; text: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "user-agent": "gitstarclub-release-gates",
        accept: "*/*",
        ...vercelProtectionBypassHeaders(),
      },
      redirect: "follow",
      cache: "no-store",
    });
  } catch (error) {
    throw new Error(`UNREACHABLE ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { status: res.status, text: await res.text() };
}

async function fetchJson(url: string): Promise<{ status: number; json: unknown; parseError?: string }> {
  const { status, text } = await fetchText(url);
  if (status !== 200) return { status, json: null };
  try {
    return { status, json: JSON.parse(text) as unknown };
  } catch {
    // Keep structured GateFinding paths: never throw past runAllLiveGates for a
    // 200 HTML/CDN body (WAF/mitigated pages sometimes surface as text/html).
    return { status, json: null, parseError: `expected JSON from ${url}` };
  }
}

type LiveArtifactProbe = (
  logicalPath: string,
  legacyPath: string,
) => Promise<LiveArtifactResolution<unknown> | null>;

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Build one fail-closed resolver per gate so all requested periods share the
 * validated live pointer and immutable manifest cache. */
async function createLiveArtifactProbe(blobBase: string): Promise<LiveArtifactProbe> {
  const pointerUrl = `${blobBase}/live/latest.json?v=${Date.now()}`;
  const pointerResponse = await fetchJson(pointerUrl);
  if (pointerResponse.parseError) throw new Error(pointerResponse.parseError);
  if (pointerResponse.status !== 200 && pointerResponse.status !== 404) {
    throw new Error(`${pointerUrl} returned HTTP ${pointerResponse.status}`);
  }
  let pointer: LiveGenerationPointer | null = null;
  if (pointerResponse.status === 200) {
    const parsedPointer = LiveGenerationPointer.safeParse(pointerResponse.json);
    if (!parsedPointer.success) {
      const issue = parsedPointer.error.issues[0];
      const location = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
      throw new Error(`live pointer invalid${location}: ${issue?.message ?? "schema mismatch"}`);
    }
    pointer = parsedPointer.data;
  }
  const manifestMemo = new Map<string, Promise<unknown | null>>();

  const readJsonKey = async (key: string): Promise<unknown | null> => {
    const url = `${blobBase}/${key}`;
    const response = await fetchJson(url);
    if (response.status === 404) return null;
    if (response.parseError) throw new Error(response.parseError);
    if (response.status !== 200) throw new Error(`${url} returned HTTP ${response.status}`);
    if (response.json === null) throw new Error(`expected non-null JSON from ${url}`);
    return response.json;
  };

  const readManifest = (generation: string): Promise<unknown | null> => {
    const memo = manifestMemo.get(generation);
    if (memo) return memo;
    const reading = readJsonKey(`live/generations/${generation}/manifest.json`);
    manifestMemo.set(generation, reading);
    void reading.catch(() => manifestMemo.delete(generation));
    return reading;
  };

  return (logicalPath, legacyPath) =>
    resolveLiveArtifactFromHistory({
      headGeneration: pointer?.generation ?? null,
      logicalPath,
      legacyPath,
      reader: {
        readGenerationArtifact: (generation, candidatePath) =>
          readJsonKey(`live/generations/${generation}/${candidatePath}`),
        readGenerationManifest: readManifest,
        readLegacyArtifact: readJsonKey,
      },
    });
}

function ageMs(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return now.getTime() - t;
}

/** ISO week id for a UTC calendar day (same algorithm as web/lib/periods.ts). */
export function isoWeekPeriodUtc(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const year = d.getUTCFullYear();
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function utcMonthPeriod(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Number of ISO weeks in a year (52 or 53). Thursday of ISO week 1 is in `year`. */
export function isoWeeksInYear(year: number): 52 | 53 {
  // A year has 53 ISO weeks if Jan 1 or Dec 31 is a Thursday (ISO day 4).
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay() || 7;
  const dec31 = new Date(Date.UTC(year, 11, 31)).getUTCDay() || 7;
  return jan1 === 4 || dec31 === 4 ? 53 : 52;
}

export function previousIsoWeek(period: string): string {
  const match = /^(\d{4})-W(\d{2})$/.exec(period);
  if (!match) throw new Error(`bad week period ${period}`);
  let year = Number(match[1]);
  let week = Number(match[2]) - 1;
  if (week < 1) {
    year -= 1;
    week = isoWeeksInYear(year);
  }
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/**
 * Grace after UTC midnight before current week/month shards are required.
 * Aligns with vercel.json daily cron `0 3 * * *` (03:00 UTC).
 */
export const PUBLICATION_SCHEDULE_GRACE_MS = 3 * 60 * 60 * 1000;

/** Recent closed ISO weeks ending before the current UTC week (exclusive). */
export function recentClosedWeeks(now = new Date(), count = 4): string[] {
  const current = isoWeekPeriodUtc(now);
  const weeks: string[] = [];
  let cursor = previousIsoWeek(current);
  for (let i = 0; i < count; i++) {
    weeks.push(cursor);
    cursor = previousIsoWeek(cursor);
  }
  return weeks;
}

export async function checkDeployedSearchIndex(siteBase: string): Promise<GateFinding> {
  const url = `${siteBase}/search-index`;
  const { status, text } = await fetchText(url);
  if (status !== 200) {
    return { id: "search-index-http", ok: false, summary: `${url} returned HTTP ${status}`, observed: { status } };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { id: "search-index-json", ok: false, summary: `${url} body is not JSON` };
  }
  const parsed = SearchIndex.safeParse(json);
  if (!parsed.success) {
    return {
      id: "search-index-schema",
      ok: false,
      summary: `${url} failed SearchIndex contract: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    };
  }
  const index = parsed.data;
  if (index.count < SEARCH_MIN_REPOS || index.repos.length !== index.count) {
    return {
      id: "search-index-count",
      ok: false,
      summary: `${url} count/repos mismatch or too small`,
      observed: { count: index.count, repos: index.repos.length },
    };
  }
  const hit = index.repos.some((repo) => repo.full_name.toLowerCase().includes("hummingbot"));
  if (!hit) {
    return {
      id: "search-index-hit",
      ok: false,
      summary: `${url} missing representative hit hummingbot/*`,
      observed: { count: index.count, generated_at: index.generated_at },
    };
  }
  return {
    id: "search-index",
    ok: true,
    summary: `${url} ok (${index.count} repos)`,
    observed: { count: index.count, generated_at: index.generated_at },
  };
}

export async function checkSyncRunsFresh(blobBase: string, now = new Date()): Promise<GateFinding> {
  const url = `${blobBase}/ops/sync-runs.json`;
  const { status, json, parseError } = await fetchJson(url);
  if (parseError) return { id: "sync-runs-json", ok: false, summary: parseError, observed: { status } };
  if (status !== 200 || !json || typeof json !== "object") {
    return { id: "sync-runs-http", ok: false, summary: `${url} returned HTTP ${status}` };
  }
  const runs = ((json as { runs?: Array<{ id?: string; status?: string; finished_at?: string; dry?: boolean }> }).runs ?? []).filter(
    (run) => !run.dry,
  );
  if (runs.length === 0) {
    return { id: "sync-runs-empty", ok: false, summary: `${url} has no non-dry runs` };
  }
  const newest = [...runs].sort((a, b) => String(b.finished_at ?? "").localeCompare(String(a.finished_at ?? "")))[0];
  const finishedAt = newest.finished_at ?? null;
  const age = ageMs(finishedAt, now);
  if (newest.status !== "ok") {
    return {
      id: "sync-runs-status",
      ok: false,
      summary: `newest sync run ${newest.id ?? "?"} status=${newest.status}`,
      observed: { id: newest.id ?? null, status: newest.status ?? null, finished_at: finishedAt },
    };
  }
  if (age == null || age > SYNC_RUN_MAX_AGE_MS) {
    return {
      id: "sync-runs-age",
      ok: false,
      summary: `newest ok sync run is too old (age_ms=${age})`,
      observed: { id: newest.id ?? null, finished_at: finishedAt, age_ms: age, max_age_ms: SYNC_RUN_MAX_AGE_MS },
    };
  }
  return {
    id: "sync-runs",
    ok: true,
    summary: `newest ok sync run ${newest.id} within ${SYNC_RUN_MAX_AGE_MS}ms`,
    observed: { id: newest.id ?? null, finished_at: finishedAt, age_ms: age },
  };
}

export async function checkBasePublishFreshness(blobBase: string, now = new Date()): Promise<GateFinding> {
  const url = `${blobBase}/views/latest.json`;
  const { status, json, parseError } = await fetchJson(url);
  if (parseError) return { id: "base-pointer-json", ok: false, summary: parseError, observed: { status } };
  if (status !== 200 || !json || typeof json !== "object") {
    return { id: "base-pointer-http", ok: false, summary: `${url} returned HTTP ${status}` };
  }
  const pointer = json as { version?: string; published_at?: string };
  const publishedAt = pointer.published_at ?? null;
  const age = ageMs(publishedAt, now);
  if (age == null || age > BASE_PUBLISH_MAX_AGE_MS) {
    return {
      id: "base-pointer-age",
      ok: false,
      summary: `base publish pointer is stale (About/search/export share this watermark)`,
      observed: {
        version: pointer.version ?? null,
        published_at: publishedAt,
        age_ms: age,
        max_age_ms: BASE_PUBLISH_MAX_AGE_MS,
      },
    };
  }
  return {
    id: "base-pointer",
    ok: true,
    summary: `base pointer ${pointer.version} fresh`,
    observed: { version: pointer.version ?? null, published_at: publishedAt, age_ms: age },
  };
}

export async function checkExportManifestFreshness(siteBase: string, now = new Date()): Promise<GateFinding> {
  const url = `${siteBase}/data/exports/v1/latest/manifest.json`;
  const { status, json, parseError } = await fetchJson(url);
  if (parseError) return { id: "export-manifest-json", ok: false, summary: parseError, observed: { status } };
  if (status !== 200 || !json || typeof json !== "object") {
    return { id: "export-manifest-http", ok: false, summary: `${url} returned HTTP ${status}` };
  }
  const manifest = json as { data_as_of?: string; export_date?: string };
  const stamp = manifest.data_as_of ?? null;
  const age = ageMs(stamp, now);
  if (age == null || age > EXPORT_MAX_AGE_MS) {
    return {
      id: "export-manifest-age",
      ok: false,
      summary: `export manifest data_as_of is stale`,
      observed: { data_as_of: stamp, export_date: manifest.export_date ?? null, age_ms: age, max_age_ms: EXPORT_MAX_AGE_MS },
    };
  }
  return {
    id: "export-manifest",
    ok: true,
    summary: `export manifest fresh (${stamp})`,
    observed: { data_as_of: stamp, export_date: manifest.export_date ?? null, age_ms: age },
  };
}

export async function checkLiveWeekContinuity(
  blobBase: string,
  now = new Date(),
  knownMissing: readonly string[] = KNOWN_MISSING_LIVE_WEEKS,
): Promise<GateFinding> {
  const weeks = recentClosedWeeks(now, 4);
  const missing: string[] = [];
  const present: string[] = [];
  const unexpected: string[] = [];
  const sources: string[] = [];
  const resolutionErrors: string[] = [];
  let probe: LiveArtifactProbe;
  try {
    probe = await createLiveArtifactProbe(blobBase);
  } catch (error) {
    return {
      id: "live-week-continuity",
      ok: false,
      summary: `live generation pointer unavailable: ${errorDetail(error)}`,
      observed: { scanned: weeks.join(",") },
    };
  }
  for (const week of weeks) {
    const path = `rank/week/${week}/repo/flow.json`;
    try {
      const resolved = await probe(path, `live/${path}`);
      if (resolved) {
        present.push(week);
        sources.push(
          `${week}:${resolved.source === "generation" ? resolved.generation : "legacy-flat"}`,
        );
        continue;
      }
      missing.push(week);
      if (!knownMissing.includes(week)) unexpected.push(week);
    } catch (error) {
      resolutionErrors.push(`${week}:${errorDetail(error)}`);
    }
  }
  if (resolutionErrors.length > 0) {
    return {
      id: "live-week-continuity",
      ok: false,
      summary: `live week resolution failed: ${resolutionErrors.join("; ")}`,
      observed: {
        scanned: weeks.join(","),
        present: present.join(","),
        sources: sources.join(","),
      },
    };
  }
  // Known gaps must still be listed; if a known gap reappears as present, that's fine.
  const stillMissingKnown = knownMissing.filter((week) => missing.includes(week));
  if (unexpected.length > 0) {
    return {
      id: "live-week-continuity",
      ok: false,
      summary: `unexpected missing live weeks: ${unexpected.join(", ")}`,
      observed: {
        scanned: weeks.join(","),
        present: present.join(","),
        missing: missing.join(","),
        known_missing_still_absent: stillMissingKnown.join(","),
        sources: sources.join(","),
      },
    };
  }
  return {
    id: "live-week-continuity",
    ok: true,
    summary:
      stillMissingKnown.length > 0
        ? `live weeks ok with documented gaps: ${stillMissingKnown.join(", ")}`
        : `live weeks continuous for ${weeks.join(", ")}`,
    observed: {
      scanned: weeks.join(","),
      present: present.join(","),
      documented_gaps: stillMissingKnown.join(","),
      sources: sources.join(","),
    },
  };
}

export function withinPublicationScheduleGrace(now: Date, graceMs = PUBLICATION_SCHEDULE_GRACE_MS): {
  weekGrace: boolean;
  monthGrace: boolean;
} {
  const msIntoUtcDay =
    ((now.getUTCHours() * 60 + now.getUTCMinutes()) * 60 + now.getUTCSeconds()) * 1000 + now.getUTCMilliseconds();
  const earlyDay = msIntoUtcDay < graceMs;
  // Monday 00:00–grace: new ISO week may not exist until daily cron (0 3 * * *).
  const weekGrace = earlyDay && now.getUTCDay() === 1;
  // 1st of month 00:00–grace: new month shard may not exist yet.
  const monthGrace = earlyDay && now.getUTCDate() === 1;
  return { weekGrace, monthGrace };
}

export async function checkCurrentLivePeriods(blobBase: string, now = new Date()): Promise<GateFinding> {
  const weekPeriod = isoWeekPeriodUtc(now);
  const monthPeriod = utcMonthPeriod(now);
  const grace = withinPublicationScheduleGrace(now);
  // Resolve the current week/month exactly as page readers do: current immutable
  // generation first, then validated history, then the legacy migration edge.
  const targets = [
    { label: "week" as const, path: `rank/week/${weekPeriod}/repo/flow.json`, grace: grace.weekGrace },
    { label: "month" as const, path: `rank/month/${monthPeriod}/repo/flow.json`, grace: grace.monthGrace },
  ];
  const missing: string[] = [];
  const deferred: string[] = [];
  const sources: string[] = [];
  let probe: LiveArtifactProbe;
  try {
    probe = await createLiveArtifactProbe(blobBase);
  } catch (error) {
    return {
      id: "live-current-periods",
      ok: false,
      summary: `live generation pointer unavailable: ${errorDetail(error)}`,
      observed: { weekPeriod, monthPeriod },
    };
  }
  for (const target of targets) {
    let resolved: LiveArtifactResolution<unknown> | null;
    try {
      resolved = await probe(target.path, `live/${target.path}`);
    } catch (error) {
      return {
        id: "live-current-periods",
        ok: false,
        summary: `${target.label} live rank resolution failed: ${errorDetail(error)}`,
        observed: { weekPeriod, monthPeriod, sources: sources.join(",") },
      };
    }
    if (resolved) {
      sources.push(
        `${target.label}:${resolved.source === "generation" ? resolved.generation : "legacy-flat"}`,
      );
      continue;
    }
    if (target.grace) deferred.push(`${target.label}:${target.path}`);
    else missing.push(`${target.label}:${target.path}`);
  }
  if (missing.length > 0) {
    return {
      id: "live-current-periods",
      ok: false,
      summary: `current live rank shards missing: ${missing.join("; ")}`,
      observed: {
        weekPeriod,
        monthPeriod,
        deferred: deferred.join(",") || null,
        sources: sources.join(","),
      },
    };
  }
  return {
    id: "live-current-periods",
    ok: true,
    summary:
      deferred.length > 0
        ? `current live periods ok (within schedule grace: ${deferred.join("; ")})`
        : `current live week ${weekPeriod} and month ${monthPeriod} present`,
    observed: {
      weekPeriod,
      monthPeriod,
      deferred: deferred.join(",") || null,
      sources: sources.join(","),
    },
  };
}

export async function runAllLiveGates(config: LiveGateConfig): Promise<GateFinding[]> {
  const now = config.now ?? new Date();
  const known = config.knownMissingWeeks ?? KNOWN_MISSING_LIVE_WEEKS;
  return [
    await checkDeployedSearchIndex(config.siteBase),
    await checkSyncRunsFresh(config.blobBase, now),
    await checkBasePublishFreshness(config.blobBase, now),
    await checkExportManifestFreshness(config.siteBase, now),
    await checkCurrentLivePeriods(config.blobBase, now),
    await checkLiveWeekContinuity(config.blobBase, now, known),
  ];
}
