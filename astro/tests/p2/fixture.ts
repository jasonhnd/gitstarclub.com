import { fixtureRecords } from "../../scripts/fixture";
import { LOCALES, localizedPath } from "../../src/lib/i18n";

export const sampleRepositories = ["example/repo", "example/history", "example/daily"];
export const paths = LOCALES.flatMap((locale) => sampleRepositories.map((name) => localizedPath(locale, `/${name}`)));

/** Synthetic cases extend local test data only; no published coverage changes. */
export function repositoryFixtures() {
  const records = fixtureRecords();
  const original = JSON.parse(records.get("entity/repo/1.json")!);
  const lookup = JSON.parse(records.get("lookup/repos.json")!);
  const put = (key: string, value: unknown) => {
    const body = JSON.stringify(value);
    records.set(key, body); records.set(`views/fixture-v1/${key}`, body);
  };
  for (const [id, name] of [[2, "history"], [3, "daily"]] as const) {
    const repo = { ...original, id, name, full_name: `example/${name}`, current_stars: 52000,
      description: `Fixture ${name} repository`, language: "TypeScript",
      languages: [{ name: "TypeScript", size: 800 }, { name: "JavaScript", size: 200 }],
      topics: ["testing", "history"], homepage_url: "https://example.com/",
      license: "MIT", latest_release: { tag_name: "v1.0.0", name: "First release", published_at: "2026-06-01", url: "https://example.com/release" },
      milestones: { crossed_10k: "2024-01-01", crossed_50k: "2026-06-01", crossed_100k: null },
      curve: { monthly: [["2024-01", 10000, 10000], ["2025-01", 10000, 20000], ["2026-06", 30000, 50000]], recent_daily: [["2026-06-01", 10], ["2026-06-02", 20], ["2026-06-03", 8]],
        ...(id === 3 ? { provenance: { source: "github_stargazers_history_aggregate", api_version: "2026-03-10", metric: "surviving_stars_at_query_time", day_boundary: "github_calendar_label_approximate_not_guaranteed_utc", day_shift: 0, week_calendar: "iso_monday_sunday_reaggregated_from_daily", monthly_policy: "preserve_published_net_do_not_fold_these_daily_values_into_months", start: "2026-05-30", end_inclusive: "2026-09-30" } } : {}),
      },
      monthly_table: [{ month: "2026-06", adds: 30000, rank: 1 }], rank_history: { month: [["2026-06", 1]] },
      inflections: [{ period: "2026-06", flow: 30000, kind: "peak" }],
    };
    put(`entity/repo/${id}.json`, repo);
    lookup[String(id)] = { ...lookup["1"], name, full_name: repo.full_name, current_stars: repo.current_stars };
  }
  put("lookup/repos.json", lookup);
  return records;
}
