import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { OrgLookupEntry, RankItem, RankList, RepoEntity, RepoLookupEntry } from "@/lib/contracts";

export const DATA_EXPORT_SCHEMA_VERSION = 1;
export const DATA_EXPORT_ATTRIBUTION = "Data from GH Archive, derived by GitStarClub.";
export const DATA_EXPORT_LICENSE = {
  name: "CC BY 4.0",
  url: "https://creativecommons.org/licenses/by/4.0/",
} as const;
export const DATA_EXPORT_BASE_PATH = "/data/exports/v1";
export const DATA_EXPORT_SITE_URL = "https://gitstarclub.com";
export const DATA_EXPORT_ENCODING_FORMAT = {
  csv: "text/csv",
  json: "application/json",
} as const;
export const DATA_EXPORT_LIMITS = {
  topRankingRowsPerList: 50,
  milestoneSourceRepos: 100,
  orgRows: 50,
} as const;

export type ExportFormat = "csv" | "json";

type JsonValue = string | number | boolean | null;
type CsvRow = Record<string, JsonValue | undefined>;

export type DataExportDownload = {
  name: string;
  contentUrl: string;
  encodingFormat: (typeof DATA_EXPORT_ENCODING_FORMAT)[ExportFormat];
};

export type ExportFileManifest = {
  name: string;
  title: string;
  formats: ExportFormat[];
  rows: number;
  source_views: string[];
  latest_urls: Record<ExportFormat, string>;
  dated_urls: Record<ExportFormat, string>;
};

export type ExportManifest = {
  schema_version: typeof DATA_EXPORT_SCHEMA_VERSION;
  export_date: string;
  data_as_of: string;
  license: typeof DATA_EXPORT_LICENSE;
  attribution: typeof DATA_EXPORT_ATTRIBUTION;
  generated_from: string;
  limits: typeof DATA_EXPORT_LIMITS;
  files: ExportFileManifest[];
};

export type JsonExport<Row extends CsvRow> = {
  schema_version: typeof DATA_EXPORT_SCHEMA_VERSION;
  export_name: string;
  title: string;
  export_date: string;
  data_as_of: string;
  license: typeof DATA_EXPORT_LICENSE;
  attribution: typeof DATA_EXPORT_ATTRIBUTION;
  generated_from: string;
  source_views: string[];
  row_count: number;
  rows: Row[];
};

export type TopRankingExportRow = CsvRow & {
  export_schema_version: number;
  export_date: string;
  data_as_of: string;
  ranking_scope: "current_month_repo_growth" | "all_time_repo_stars";
  period: string;
  metric: "stars_gained" | "current_stars";
  rank: number;
  repo_id: number;
  full_name: string;
  owner: string;
  name: string;
  language: string | null;
  value: number;
  current_stars: number;
  url: string;
  source_view: string;
  license: string;
  attribution: string;
};

export type MilestoneExportRow = CsvRow & {
  export_schema_version: number;
  export_date: string;
  data_as_of: string;
  rank: number;
  repo_id: number;
  full_name: string;
  owner: string;
  name: string;
  language: string | null;
  current_stars: number;
  crossed_10k: string | null;
  crossed_50k: string | null;
  crossed_100k: string | null;
  url: string;
  source_views: string;
  license: string;
  attribution: string;
};

export type OrgAggregateExportRow = CsvRow & {
  export_schema_version: number;
  export_date: string;
  data_as_of: string;
  rank: number;
  login: string;
  owner_type: OrgLookupEntry["owner_type"];
  repo_count: number;
  current_stars_sum: number;
  rank_value: number;
  url: string;
  source_view: string;
  license: string;
  attribution: string;
};

export type DataExportBundle = {
  manifest: ExportManifest;
  json: {
    topRankings: JsonExport<TopRankingExportRow>;
    topRepoMilestones: JsonExport<MilestoneExportRow>;
    topOrgAggregates: JsonExport<OrgAggregateExportRow>;
  };
  csv: {
    topRankings: string;
    topRepoMilestones: string;
    topOrgAggregates: string;
  };
};

export function buildDataExportBundle({
  currentMonthRepoGrowth,
  allTimeRepoStars,
  allTimeOrgStars,
  repoLookup,
  orgLookup,
  repoEntities,
}: {
  currentMonthRepoGrowth: RankList;
  allTimeRepoStars: RankList;
  allTimeOrgStars: RankList;
  repoLookup: Record<string, RepoLookupEntry>;
  orgLookup: Record<string, OrgLookupEntry>;
  repoEntities: RepoEntity[];
}): DataExportBundle {
  const dataAsOf = latestTimestamp(
    currentMonthRepoGrowth.meta.generated_at,
    allTimeRepoStars.meta.generated_at,
    allTimeOrgStars.meta.generated_at,
  );
  const exportDate = dataAsOf.slice(0, 10);

  const topRankings = buildJsonExport({
    exportName: "top-rankings",
    title: "GitStarClub top repository rankings",
    exportDate,
    dataAsOf,
    sourceViews: [
      sourceViewForRank(currentMonthRepoGrowth),
      sourceViewForRank(allTimeRepoStars),
      "lookup/repos.json",
    ],
    rows: [
      ...joinRepoRank(currentMonthRepoGrowth.items, repoLookup)
        .slice(0, DATA_EXPORT_LIMITS.topRankingRowsPerList)
        .map<TopRankingExportRow>((repo) => ({
          ...baseRow(exportDate, dataAsOf),
          ranking_scope: "current_month_repo_growth",
          period: currentMonthRepoGrowth.meta.period,
          metric: "stars_gained",
          rank: repo.rank,
          repo_id: repo.id,
          full_name: repo.full_name,
          owner: repo.owner,
          name: repo.name,
          language: repo.language,
          value: repo.value,
          current_stars: repo.current_stars,
          url: `${DATA_EXPORT_SITE_URL}/${repo.owner}/${repo.name}`,
          source_view: sourceViewForRank(currentMonthRepoGrowth),
          ...licenseRow(),
        })),
      ...joinRepoRank(allTimeRepoStars.items, repoLookup)
        .slice(0, DATA_EXPORT_LIMITS.topRankingRowsPerList)
        .map<TopRankingExportRow>((repo) => ({
          ...baseRow(exportDate, dataAsOf),
          ranking_scope: "all_time_repo_stars",
          period: allTimeRepoStars.meta.period,
          metric: "current_stars",
          rank: repo.rank,
          repo_id: repo.id,
          full_name: repo.full_name,
          owner: repo.owner,
          name: repo.name,
          language: repo.language,
          value: repo.value,
          current_stars: repo.current_stars,
          url: `${DATA_EXPORT_SITE_URL}/${repo.owner}/${repo.name}`,
          source_view: sourceViewForRank(allTimeRepoStars),
          ...licenseRow(),
        })),
    ],
  });

  const entitiesById = new Map(repoEntities.map((repo) => [repo.id, repo]));
  const topRepoMilestones = buildJsonExport({
    exportName: "top-repo-milestones",
    title: "GitStarClub top repository milestone crossings",
    exportDate,
    dataAsOf,
    sourceViews: [
      sourceViewForRank(allTimeRepoStars),
      "lookup/repos.json",
      "entity/repo/{id}.json",
    ],
    rows: joinRepoRank(allTimeRepoStars.items, repoLookup)
      .slice(0, DATA_EXPORT_LIMITS.milestoneSourceRepos)
      .flatMap<MilestoneExportRow>((repo) => {
        const entity = entitiesById.get(repo.id);
        if (!entity || !hasMilestone(entity)) return [];
        return [
          {
            ...baseRow(exportDate, dataAsOf),
            rank: repo.rank,
            repo_id: repo.id,
            full_name: repo.full_name,
            owner: repo.owner,
            name: repo.name,
            language: repo.language,
            current_stars: repo.current_stars,
            crossed_10k: entity.milestones.crossed_10k,
            crossed_50k: entity.milestones.crossed_50k,
            crossed_100k: entity.milestones.crossed_100k,
            url: `${DATA_EXPORT_SITE_URL}/${repo.owner}/${repo.name}`,
            source_views: `${sourceViewForRank(allTimeRepoStars)};lookup/repos.json;entity/repo/${repo.id}.json`,
            ...licenseRow(),
          },
        ];
      }),
  });

  const topOrgAggregates = buildJsonExport({
    exportName: "top-org-aggregates",
    title: "GitStarClub top organization aggregates",
    exportDate,
    dataAsOf,
    sourceViews: [
      sourceViewForRank(allTimeOrgStars),
      "lookup/orgs.json",
    ],
    rows: joinOrgRank(allTimeOrgStars.items, orgLookup)
      .slice(0, DATA_EXPORT_LIMITS.orgRows)
      .map<OrgAggregateExportRow>((org) => ({
        ...baseRow(exportDate, dataAsOf),
        rank: org.rank,
        login: org.login,
        owner_type: org.owner_type,
        repo_count: org.repo_count,
        current_stars_sum: org.current_stars_sum,
        rank_value: org.value,
        url: `${DATA_EXPORT_SITE_URL}/o/${org.login}`,
        source_view: sourceViewForRank(allTimeOrgStars),
        ...licenseRow(),
      })),
  });

  const manifest = buildManifest(exportDate, dataAsOf, [
    fileManifest(topRankings),
    fileManifest(topRepoMilestones),
    fileManifest(topOrgAggregates),
  ]);

  return {
    manifest,
    json: {
      topRankings,
      topRepoMilestones,
      topOrgAggregates,
    },
    csv: {
      topRankings: toCsv(topRankings, TOP_RANKING_CSV_FIELDS),
      topRepoMilestones: toCsv(topRepoMilestones, MILESTONE_CSV_FIELDS),
      topOrgAggregates: toCsv(topOrgAggregates, ORG_AGGREGATE_CSV_FIELDS),
    },
  };
}

export const TOP_RANKING_CSV_FIELDS = [
  "export_schema_version",
  "export_date",
  "data_as_of",
  "ranking_scope",
  "period",
  "metric",
  "rank",
  "repo_id",
  "full_name",
  "owner",
  "name",
  "language",
  "value",
  "current_stars",
  "url",
  "source_view",
  "license",
  "attribution",
] as const satisfies readonly (keyof TopRankingExportRow)[];

export const MILESTONE_CSV_FIELDS = [
  "export_schema_version",
  "export_date",
  "data_as_of",
  "rank",
  "repo_id",
  "full_name",
  "owner",
  "name",
  "language",
  "current_stars",
  "crossed_10k",
  "crossed_50k",
  "crossed_100k",
  "url",
  "source_views",
  "license",
  "attribution",
] as const satisfies readonly (keyof MilestoneExportRow)[];

export const ORG_AGGREGATE_CSV_FIELDS = [
  "export_schema_version",
  "export_date",
  "data_as_of",
  "rank",
  "login",
  "owner_type",
  "repo_count",
  "current_stars_sum",
  "rank_value",
  "url",
  "source_view",
  "license",
  "attribution",
] as const satisfies readonly (keyof OrgAggregateExportRow)[];

export function toCsv<Row extends CsvRow>(exportData: JsonExport<Row>, fields: readonly (keyof Row & string)[]): string {
  const lines = [
    fields.join(","),
    ...exportData.rows.map((row) => fields.map((field) => csvCell(row[field])).join(",")),
  ];
  return `${lines.join("\n")}\n`;
}

function buildJsonExport<Row extends CsvRow>({
  exportName,
  title,
  exportDate,
  dataAsOf,
  sourceViews,
  rows,
}: {
  exportName: string;
  title: string;
  exportDate: string;
  dataAsOf: string;
  sourceViews: string[];
  rows: Row[];
}): JsonExport<Row> {
  return {
    schema_version: DATA_EXPORT_SCHEMA_VERSION,
    export_name: exportName,
    title,
    export_date: exportDate,
    data_as_of: dataAsOf,
    license: DATA_EXPORT_LICENSE,
    attribution: DATA_EXPORT_ATTRIBUTION,
    generated_from: "Existing precomputed GitStarClub Blob views.",
    source_views: sourceViews,
    row_count: rows.length,
    rows,
  };
}

function buildManifest(exportDate: string, dataAsOf: string, files: ExportFileManifest[]): ExportManifest {
  return {
    schema_version: DATA_EXPORT_SCHEMA_VERSION,
    export_date: exportDate,
    data_as_of: dataAsOf,
    license: DATA_EXPORT_LICENSE,
    attribution: DATA_EXPORT_ATTRIBUTION,
    generated_from: "Existing precomputed GitStarClub Blob views.",
    limits: DATA_EXPORT_LIMITS,
    files,
  };
}

function fileManifest(exportData: JsonExport<CsvRow>): ExportFileManifest {
  const name = exportData.export_name;
  return {
    name,
    title: exportData.title,
    formats: ["json", "csv"],
    rows: exportData.row_count,
    source_views: exportData.source_views,
    latest_urls: {
      json: `${DATA_EXPORT_BASE_PATH}/latest/${name}.json`,
      csv: `${DATA_EXPORT_BASE_PATH}/latest/${name}.csv`,
    },
    dated_urls: {
      json: `${DATA_EXPORT_BASE_PATH}/${exportData.export_date}/${name}.json`,
      csv: `${DATA_EXPORT_BASE_PATH}/${exportData.export_date}/${name}.csv`,
    },
  };
}

export function dataExportDownloadsFromManifest(manifest: Pick<ExportManifest, "files">): DataExportDownload[] {
  return [
    {
      name: "GitStarClub data export manifest",
      contentUrl: canonicalExportUrl(`${DATA_EXPORT_BASE_PATH}/latest/manifest.json`),
      encodingFormat: DATA_EXPORT_ENCODING_FORMAT.json,
    },
    ...manifest.files.flatMap((file) =>
      file.formats.flatMap((format) => {
        const latestUrl = file.latest_urls[format];
        if (!latestUrl) return [];
        return [
          {
            name: `${file.title} (${format.toUpperCase()})`,
            contentUrl: canonicalExportUrl(latestUrl),
            encodingFormat: DATA_EXPORT_ENCODING_FORMAT[format],
          },
        ];
      }),
    ),
  ];
}

export function readLatestStaticDataExportManifest(): ExportManifest | null {
  const root = staticExportRoot();
  if (!root) return null;
  const latestDate = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!latestDate) return null;

  const manifestPath = join(root, latestDate, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, "utf8")) as ExportManifest;
}

function canonicalExportUrl(path: string): string {
  return `${DATA_EXPORT_SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function staticExportRoot(): string | null {
  const candidates = [
    join(process.cwd(), "public", "data", "exports", "v1"),
    join(process.cwd(), "web", "public", "data", "exports", "v1"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function latestTimestamp(...values: string[]): string {
  return [...values].sort().at(-1)!;
}

type RankedRepo = RankItem & RepoLookupEntry & { id: number };
type RankedOrg = RankItem & OrgLookupEntry;

function joinRepoRank(items: RankItem[], lookup: Record<string, RepoLookupEntry>): RankedRepo[] {
  return items.flatMap((item) => {
    if (item.id == null) return [];
    const id = item.id;
    const meta = lookup[String(id)];
    return meta ? [{ ...item, ...meta, id }] : [];
  });
}

function joinOrgRank(items: RankItem[], lookup: Record<string, OrgLookupEntry>): RankedOrg[] {
  return items.flatMap((item) => {
    const meta = item.login != null ? lookup[item.login] : undefined;
    return meta ? [{ ...item, ...meta }] : [];
  });
}

function sourceViewForRank(rank: RankList): string {
  const { window, period, dim, metric } = rank.meta;
  if (window === "all") return `rank/all-time/${dim}/${metric}.json`;
  return `rank/${window}/${period}/${dim}/${metric}.json`;
}

function baseRow(exportDate: string, dataAsOf: string) {
  return {
    export_schema_version: DATA_EXPORT_SCHEMA_VERSION,
    export_date: exportDate,
    data_as_of: dataAsOf,
  };
}

function licenseRow() {
  return {
    license: DATA_EXPORT_LICENSE.name,
    attribution: DATA_EXPORT_ATTRIBUTION,
  };
}

function hasMilestone(repo: RepoEntity): boolean {
  return Boolean(repo.milestones.crossed_10k || repo.milestones.crossed_50k || repo.milestones.crossed_100k);
}

function csvCell(value: JsonValue | undefined): string {
  if (value == null) return "";
  const text = typeof value === "string" ? neutralizeCsvFormula(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function neutralizeCsvFormula(value: string): string {
  return /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
}
