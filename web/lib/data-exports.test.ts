import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { OrgLookupEntry, RankList, RepoEntity, RepoLookupEntry } from "@/lib/contracts";
import {
  DATA_EXPORT_ATTRIBUTION,
  DATA_EXPORT_ENCODING_FORMAT,
  DATA_EXPORT_LICENSE,
  DATA_EXPORT_LIMITS,
  DATA_EXPORT_SITE_URL,
  DATA_EXPORT_SCHEMA_VERSION,
  buildDataExportBundle,
  dataExportDownloadsFromManifest,
  readLatestStaticDataExportManifest,
  toCsv,
  type JsonExport,
} from "./data-exports";

const generatedExportRoot = join(import.meta.dir, "..", "public", "data", "exports", "v1");

describe("buildDataExportBundle", () => {
  test("builds deterministic bounded JSON and CSV exports with attribution", () => {
    const repoLookup = {
      "1": repoLookupEntry({ owner: "alpha", name: "one", full_name: "alpha/one", current_stars: 200000 }),
      "2": repoLookupEntry({ owner: "beta", name: "two", full_name: "beta/two", current_stars: 150000 }),
      "3": repoLookupEntry({ owner: "gamma", name: "three", full_name: "gamma/three", current_stars: 120000 }),
    } satisfies Record<string, RepoLookupEntry>;
    const orgLookup = {
      alpha: orgLookupEntry({ login: "alpha", current_stars_sum: 300000, repo_count: 8 }),
      beta: orgLookupEntry({ login: "beta", current_stars_sum: 250000, repo_count: 5 }),
    } satisfies Record<string, OrgLookupEntry>;

    const bundle = buildDataExportBundle({
      currentMonthRepoGrowth: rankList({
        window: "month",
        period: "2026-06",
        dim: "repo",
        metric: "flow",
        generated_at: "2026-06-24T01:00:00.000Z",
        items: [
          { rank: 1, id: 2, value: 5000, prev_rank: null },
          { rank: 2, id: 1, value: 3000, prev_rank: 1 },
        ],
      }),
      allTimeRepoStars: rankList({
        window: "all",
        period: "all",
        dim: "repo",
        metric: "stock",
        generated_at: "2026-06-24T02:00:00.000Z",
        items: [
          { rank: 1, id: 1, value: 200000, prev_rank: null },
          { rank: 2, id: 2, value: 150000, prev_rank: null },
          { rank: 3, id: 3, value: 120000, prev_rank: null },
        ],
      }),
      allTimeOrgStars: rankList({
        window: "all",
        period: "all",
        dim: "org",
        metric: "stock",
        generated_at: "2026-06-24T03:00:00.000Z",
        items: [
          { rank: 1, login: "alpha", value: 300000, prev_rank: null },
          { rank: 2, login: "beta", value: 250000, prev_rank: null },
        ],
      }),
      repoLookup,
      orgLookup,
      repoEntities: [
        repoEntity({
          id: 1,
          full_name: "alpha/one",
          owner: "alpha",
          name: "one",
          current_stars: 200000,
          milestones: { crossed_10k: "2018-01-02", crossed_50k: "2020-01-02", crossed_100k: "2022-01-02" },
        }),
        repoEntity({
          id: 2,
          full_name: "beta/two",
          owner: "beta",
          name: "two",
          current_stars: 150000,
          milestones: { crossed_10k: "2019-01-02", crossed_50k: null, crossed_100k: null },
        }),
      ],
    });

    expect(bundle.manifest).toMatchObject({
      schema_version: DATA_EXPORT_SCHEMA_VERSION,
      export_date: "2026-06-24",
      data_as_of: "2026-06-24T03:00:00.000Z",
      license: DATA_EXPORT_LICENSE,
      attribution: DATA_EXPORT_ATTRIBUTION,
      generated_from: "Existing precomputed GitStarClub Blob views.",
    });
    expect(bundle.json.topRankings.rows.map((row) => `${row.ranking_scope}:${row.full_name}`)).toEqual([
      "current_month_repo_growth:beta/two",
      "current_month_repo_growth:alpha/one",
      "all_time_repo_stars:alpha/one",
      "all_time_repo_stars:beta/two",
      "all_time_repo_stars:gamma/three",
    ]);
    expect(bundle.json.topRepoMilestones.rows).toHaveLength(2);
    expect(bundle.json.topOrgAggregates.rows.map((row) => row.login)).toEqual(["alpha", "beta"]);
    expect(bundle.csv.topRankings.split("\n")[0]).toBe(
      "export_schema_version,export_date,data_as_of,ranking_scope,period,metric,rank,repo_id,full_name,owner,name,language,value,current_stars,url,source_view,license,attribution",
    );
    expect(bundle.csv.topRankings).toContain(DATA_EXPORT_ATTRIBUTION);
    expect(bundle.manifest.files).toHaveLength(3);
    expect(bundle.manifest.files[0].dated_urls.json).toBe("/data/exports/v1/2026-06-24/top-rankings.json");
    expect(dataExportDownloadsFromManifest(bundle.manifest).map((download) => download.contentUrl)).toEqual([
      `${DATA_EXPORT_SITE_URL}/data/exports/v1/latest/manifest.json`,
      `${DATA_EXPORT_SITE_URL}/data/exports/v1/latest/top-rankings.json`,
      `${DATA_EXPORT_SITE_URL}/data/exports/v1/latest/top-rankings.csv`,
      `${DATA_EXPORT_SITE_URL}/data/exports/v1/latest/top-repo-milestones.json`,
      `${DATA_EXPORT_SITE_URL}/data/exports/v1/latest/top-repo-milestones.csv`,
      `${DATA_EXPORT_SITE_URL}/data/exports/v1/latest/top-org-aggregates.json`,
      `${DATA_EXPORT_SITE_URL}/data/exports/v1/latest/top-org-aggregates.csv`,
    ]);
  });

  test("escapes CSV cells with commas, quotes, and line breaks", () => {
    const csv = toCsv(
      {
        schema_version: DATA_EXPORT_SCHEMA_VERSION,
        export_name: "sample",
        title: "Sample",
        export_date: "2026-06-24",
        data_as_of: "2026-06-24T00:00:00.000Z",
        license: DATA_EXPORT_LICENSE,
        attribution: DATA_EXPORT_ATTRIBUTION,
        generated_from: "Existing precomputed GitStarClub Blob views.",
        source_views: ["sample.json"],
        row_count: 1,
        rows: [{ name: 'quoted, "repo"\nnext' }],
      } satisfies JsonExport<{ name: string }>,
      ["name"],
    );

    expect(csv).toBe('name\n"quoted, ""repo""\nnext"\n');
  });
});

describe("checked-in data export manifest", () => {
  test("keeps generated static exports bounded and attributed", () => {
    const generatedManifestPath = latestDatedManifestPath();
    expect(generatedManifestPath).not.toBeNull();
    expect(existsSync(generatedManifestPath ?? "")).toBe(true);
    const manifest = JSON.parse(readFileSync(generatedManifestPath ?? "", "utf8")) as {
      schema_version: number;
      export_date: string;
      data_as_of: string;
      license: { name: string; url: string };
      attribution: string;
      files: Array<{ name: string; rows: number; latest_urls: Record<string, string>; dated_urls: Record<string, string> }>;
    };

    expect(manifest.schema_version).toBe(DATA_EXPORT_SCHEMA_VERSION);
    expect(manifest.export_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(manifest.data_as_of).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(manifest.license).toEqual(DATA_EXPORT_LICENSE);
    expect(manifest.attribution).toBe(DATA_EXPORT_ATTRIBUTION);
    expect(manifest.files.map((file) => file.name)).toEqual([
      "top-rankings",
      "top-repo-milestones",
      "top-org-aggregates",
    ]);
    expect(manifest.files[0].rows).toBeLessThanOrEqual(DATA_EXPORT_LIMITS.topRankingRowsPerList * 2);
    expect(manifest.files[1].rows).toBeLessThanOrEqual(DATA_EXPORT_LIMITS.milestoneSourceRepos);
    expect(manifest.files[2].rows).toBeLessThanOrEqual(DATA_EXPORT_LIMITS.orgRows);
    for (const file of manifest.files) {
      expect(file.latest_urls.json).toBe(`/data/exports/v1/latest/${file.name}.json`);
      expect(file.latest_urls.csv).toBe(`/data/exports/v1/latest/${file.name}.csv`);
      expect(file.dated_urls.json).toBe(`/data/exports/v1/${manifest.export_date}/${file.name}.json`);
      expect(file.dated_urls.csv).toBe(`/data/exports/v1/${manifest.export_date}/${file.name}.csv`);
      expect(existsSync(join(generatedExportRoot, "latest", `${file.name}.json`))).toBe(false);
      expect(existsSync(join(generatedExportRoot, "latest", `${file.name}.csv`))).toBe(false);
    }
    expect(existsSync(join(generatedExportRoot, "latest", "manifest.json"))).toBe(false);

    const downloads = dataExportDownloadsFromManifest(manifest);
    expect(downloads).toHaveLength(manifest.files.reduce((count, file) => count + file.formats.length, 1));
    expect(downloads[0]).toEqual({
      name: "GitStarClub data export manifest",
      contentUrl: "https://gitstarclub.com/data/exports/v1/latest/manifest.json",
      encodingFormat: DATA_EXPORT_ENCODING_FORMAT.json,
    });
    for (const file of manifest.files) {
      for (const format of file.formats) {
        expect(downloads).toContainEqual({
          name: `${file.title} (${format.toUpperCase()})`,
          contentUrl: `https://gitstarclub.com${file.latest_urls[format]}`,
          encodingFormat: DATA_EXPORT_ENCODING_FORMAT[format],
        });
      }
    }
  });

  test("finds the latest checked-in dated manifest", () => {
    const manifest = readLatestStaticDataExportManifest();

    expect(manifest).not.toBeNull();
    expect(manifest?.files.length).toBeGreaterThan(0);
  });
});

function latestDatedManifestPath(): string | null {
  if (!existsSync(generatedExportRoot)) return null;
  const latestDate = readdirSync(generatedExportRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  return latestDate ? join(generatedExportRoot, latestDate, "manifest.json") : null;
}

function rankList({ items, ...meta }: RankList["meta"] & { items: RankList["items"] }): RankList {
  return { meta, items };
}

function repoLookupEntry(overrides: Partial<RepoLookupEntry> = {}): RepoLookupEntry {
  return {
    owner: "owner",
    name: "repo",
    full_name: "owner/repo",
    owner_type: "Organization",
    language: "TypeScript",
    current_stars: 1000,
    ...overrides,
  };
}

function orgLookupEntry(overrides: Partial<OrgLookupEntry> = {}): OrgLookupEntry {
  return {
    login: "owner",
    owner_type: "Organization",
    repo_count: 1,
    current_stars_sum: 1000,
    ...overrides,
  };
}

function repoEntity(overrides: Partial<RepoEntity> = {}): RepoEntity {
  return {
    id: 1,
    full_name: "owner/repo",
    owner: "owner",
    owner_type: "Organization",
    name: "repo",
    description: null,
    language: "TypeScript",
    languages: [],
    topics: [],
    homepage_url: null,
    license: null,
    latest_release: null,
    created_at: "2020-01-01",
    current_stars: 1000,
    is_archived: false,
    milestones: {
      crossed_10k: null,
      crossed_50k: null,
      crossed_100k: null,
    },
    curve: {
      monthly: [],
      recent_daily: [],
    },
    monthly_table: [],
    rank_history: {},
    inflections: [],
    ...overrides,
  };
}
