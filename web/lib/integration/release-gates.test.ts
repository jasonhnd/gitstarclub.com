import { describe, expect, test } from "bun:test";
import en from "@/lib/i18n/dictionaries/en";
import { getDictionary, LOCALES, type Locale } from "@/lib/i18n";
import { SearchIndex } from "@/lib/contracts";
import {
  liveGatesRequired,
  recentClosedWeeks,
  resolveLiveGateConfig,
  runAllLiveGates,
} from "./release-gates-live";

// Product-level release gates (#286).
//
// Offline checks always run in `static` CI.
// Live checks run when RELEASE_GATE_REQUIRE_LIVE=1 (product-gates CI job) and
// fail closed if site/blob config is missing or any finding is not ok.
// They never silently no-op under REQUIRE_LIVE.

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

describe("release gate: live helper pure functions (#286)", () => {
  test("recentClosedWeeks returns previous ISO weeks before the current week", () => {
    const weeks = recentClosedWeeks(new Date("2026-07-15T12:00:00.000Z"), 4);
    expect(weeks[0]).toBe("2026-W28");
    expect(weeks).toHaveLength(4);
    expect(weeks).not.toContain("2026-W29");
  });
});

const requireLive = liveGatesRequired();
const liveConfig = resolveLiveGateConfig();

if (requireLive) {
  describe("release gate: live product deployment (#286, required)", () => {
    test("configuration is present (fail closed)", () => {
      if ("error" in liveConfig) {
        throw new Error(liveConfig.error);
      }
      expect(liveConfig.siteBase.length).toBeGreaterThan(0);
      expect(liveConfig.blobBase.length).toBeGreaterThan(0);
    });

    test("deployed search, freshness, export, and week continuity gates all pass", async () => {
      if ("error" in liveConfig) throw new Error(liveConfig.error);
      const findings = await runAllLiveGates(liveConfig);
      const failed = findings.filter((finding) => !finding.ok);
      if (failed.length > 0) {
        const detail = failed.map((finding) => `${finding.id}: ${finding.summary} ${JSON.stringify(finding.observed ?? {})}`).join("\n");
        throw new Error(`live product gates failed:\n${detail}`);
      }
      for (const finding of findings) {
        expect(finding.ok, finding.summary).toBe(true);
      }
    }, 120_000);
  });
} else {
  describe("release gate: live product deployment (#286, optional locally)", () => {
    test("skips live checks unless RELEASE_GATE_REQUIRE_LIVE=1", () => {
      // Documented opt-in: local developers can run
      // RELEASE_GATE_REQUIRE_LIVE=1 RELEASE_GATE_SITE=https://gitstarclub.com bun test lib/integration/release-gates.test.ts
      expect(requireLive).toBe(false);
    });
  });
}
