import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import en from "@/lib/i18n/dictionaries/en";
import { getDictionary, LOCALES, type Locale } from "@/lib/i18n";
import { SearchIndex } from "@/lib/contracts";

// Product-level release gates (#286): localization completeness, search contract
// resilience, and optional live freshness/search checks when a real Blob base is
// available (web/.env.local). CI sets a fake BLOB_BASE_URL for unit tests — do not
// treat that as permission to hit production.

const ABOUT_MARKER_KEYS = [
  "trackedHeading",
  "rankingHeading",
  "categoryHeading",
  "limitationsHeading",
  "citationHeading",
  "faqWhatQ",
  "faqRuntimeA",
] as const;

const NON_EN = LOCALES.filter((locale): locale is Exclude<Locale, "en"> => locale !== "en");

function readLocalBlobBase(): string | null {
  const envPath = join(import.meta.dir, "..", "..", ".env.local");
  if (!existsSync(envPath)) return null;
  try {
    const raw = readFileSync(envPath, "utf8");
    const match = raw.match(/^\s*BLOB_BASE_URL\s*=\s*"?([^"\r\n]+)"?\s*$/m);
    return match ? match[1].trim().replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

describe("release gate: about localization completeness (#284 / #286)", () => {
  test("every locale dictionary carries the full about key surface", async () => {
    for (const locale of LOCALES) {
      const dict = await getDictionary(locale);
      expect(Object.keys(dict.about).sort()).toEqual(Object.keys(en.about).sort());
    }
  });

  test("non-English locales translate the primary About section markers", async () => {
    for (const locale of NON_EN) {
      const dict = await getDictionary(locale);
      for (const key of ABOUT_MARKER_KEYS) {
        expect(dict.about[key].length).toBeGreaterThan(0);
        expect(dict.about[key], `${locale}.about.${key} still equals English`).not.toBe(en.about[key]);
      }
    }
  });
});

describe("release gate: search index contract resilience (#283 / #286)", () => {
  test("accepts legacy refresh run-id generated_at payloads still live on Blob", () => {
    const parsed = SearchIndex.parse({
      generated_at: "refresh-2026-06-21T06-00-05-520Z",
      count: 1,
      repos: [
        {
          id: 1,
          full_name: "hummingbot/hummingbot",
          owner: "hummingbot",
          language: "Python",
          current_stars: 1,
          description: null,
        },
      ],
    });
    expect(parsed.generated_at).toBe("2026-06-21T06:00:05.520Z");
    expect(parsed.repos[0].full_name).toBe("hummingbot/hummingbot");
  });
});

const BLOB = readLocalBlobBase();
const SITE = process.env.LIVE_SMOKE_SITE_URL ?? "https://gitstarclub.com";

if (BLOB) {
  describe("release gate: live data freshness and search (#280 / #286)", () => {
    test("production /search-index returns a non-empty schema-valid index", async () => {
      const res = await fetch(`${SITE}/search-index`, { headers: { accept: "application/json" } });
      expect(res.status).toBe(200);
      const body = SearchIndex.parse(await res.json());
      expect(body.count).toBeGreaterThan(1000);
      expect(body.repos.length).toBe(body.count);
      expect(body.repos.some((repo) => repo.full_name.includes("hummingbot"))).toBe(true);
    }, 30_000);

    test("newest non-dry sync run is ok and younger than 4 days", async () => {
      const res = await fetch(`${BLOB}/ops/sync-runs.json`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        runs?: Array<{ id?: string; status?: string; finished_at?: string; dry?: boolean }>;
      };
      const runs = (json.runs ?? []).filter((run) => !run.dry);
      expect(runs.length).toBeGreaterThan(0);
      const newest = [...runs].sort((a, b) => String(b.finished_at).localeCompare(String(a.finished_at)))[0];
      expect(newest.status).toBe("ok");
      const finishedAt = Date.parse(newest.finished_at ?? "");
      expect(Number.isFinite(finishedAt)).toBe(true);
      const ageMs = Date.now() - finishedAt;
      expect(ageMs).toBeLessThan(4 * 24 * 60 * 60 * 1000);
    }, 30_000);
  });
}
