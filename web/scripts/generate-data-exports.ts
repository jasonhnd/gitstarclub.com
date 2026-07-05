import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentUtcPeriods } from "../lib/periods";
import { buildDataExportBundle, type DataExportBundle } from "../lib/data-exports";
import { loadWebEnvFiles, warnEnvFileDiagnostic } from "./lib/env";

const BLOB_BASE_KEYS = ["BLOB_BASE_URL", "NEXT_PUBLIC_BLOB_BASE_URL"] as const;
const webDir = fileURLToPath(new URL("..", import.meta.url));
const publicDir = join(webDir, "public");
const exportRoot = join(publicDir, "data", "exports", "v1");

type Args = {
  month: string;
};

function usage(): void {
  console.log(
    [
      "Usage: bun run exports:generate [--month YYYY-MM]",
      "",
      "Generates bounded static CSV/JSON exports under web/public/data/exports/v1/.",
      "Reads BLOB_BASE_URL or NEXT_PUBLIC_BLOB_BASE_URL, also from web/.env.local when present.",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): Args {
  let month = currentUtcPeriods().monthPeriod;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (arg === "--month") {
      month = argv[++index] ?? "";
      continue;
    }
    if (arg.startsWith("--month=")) {
      month = arg.slice("--month=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`Invalid --month value: ${month}`);
  return { month };
}

function loadBlobBaseFromEnvFile(): void {
  loadWebEnvFiles(webDir, {
    keys: BLOB_BASE_KEYS,
    onDiagnostic: warnEnvFileDiagnostic,
  });
}

function ensureBlobBase(): void {
  loadBlobBaseFromEnvFile();
  const key = BLOB_BASE_KEYS.find((candidate) => process.env[candidate]?.trim());
  if (!key) throw new Error("Missing BLOB_BASE_URL or NEXT_PUBLIC_BLOB_BASE_URL.");
  const raw = process.env[key]?.trim() ?? "";
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${key} must be an http(s) URL.`);
}

async function buildBundle(month: string): Promise<DataExportBundle> {
  ensureBlobBase();
  const [{ getAllTime, getRank, getRepoEntity, getReposLookup, getOrgsLookup }] = await Promise.all([
    import("../lib/data/index"),
  ]);

  const [currentMonthRepoGrowth, allTimeRepoStars, allTimeOrgStars, repoLookup, orgLookup] = await Promise.all([
    getRank("month", month, "repo", "flow"),
    getAllTime("repo"),
    getAllTime("org"),
    getReposLookup(),
    getOrgsLookup(),
  ]);
  if (!currentMonthRepoGrowth) throw new Error(`Missing current month rank view for ${month}`);
  if (!allTimeRepoStars) throw new Error("Missing all-time repo stock rank view");
  if (!allTimeOrgStars) throw new Error("Missing all-time org stock rank view");
  if (!repoLookup) throw new Error("Missing lookup/repos.json view");
  if (!orgLookup) throw new Error("Missing lookup/orgs.json view");

  const repoEntities = (
    await Promise.all(
      allTimeRepoStars.items
        .slice(0, 100)
        .flatMap((item) => (item.id == null ? [] : [getRepoEntity(item.id)])),
    )
  ).flatMap((entity) => (entity ? [entity] : []));

  return buildDataExportBundle({
    currentMonthRepoGrowth,
    allTimeRepoStars,
    allTimeOrgStars,
    repoLookup,
    orgLookup,
    repoEntities,
  });
}

function writeBundle(bundle: DataExportBundle): void {
  const latestDir = join(exportRoot, "latest");
  const datedDir = join(exportRoot, bundle.manifest.export_date);
  removeLatestDir(latestDir);
  writeBundleDir(bundle, datedDir);
}

function removeLatestDir(latestDir: string): void {
  assertInsideExportRoot(latestDir);
  rmSync(latestDir, { recursive: true, force: true });
}

function writeBundleDir(bundle: DataExportBundle, outDir: string): void {
  assertInsideExportRoot(outDir);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeJson(join(outDir, "manifest.json"), bundle.manifest);
  writeJson(join(outDir, "top-rankings.json"), bundle.json.topRankings);
  writeFileSync(join(outDir, "top-rankings.csv"), bundle.csv.topRankings, "utf8");
  writeJson(join(outDir, "top-repo-milestones.json"), bundle.json.topRepoMilestones);
  writeFileSync(join(outDir, "top-repo-milestones.csv"), bundle.csv.topRepoMilestones, "utf8");
  writeJson(join(outDir, "top-org-aggregates.json"), bundle.json.topOrgAggregates);
  writeFileSync(join(outDir, "top-org-aggregates.csv"), bundle.csv.topOrgAggregates, "utf8");
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function assertInsideExportRoot(path: string): void {
  const root = resolve(exportRoot);
  const target = resolve(path);
  const rel = relative(root, target);
  if (rel.startsWith("..") || rel === "" || rel.includes("..\\")) {
    throw new Error(`Refusing to write outside ${root}: ${target}`);
  }
}

const args = parseArgs(process.argv.slice(2));
const bundle = await buildBundle(args.month);
writeBundle(bundle);

console.log(
  JSON.stringify(
    {
      ok: true,
      export_date: bundle.manifest.export_date,
      data_as_of: bundle.manifest.data_as_of,
      rows: Object.fromEntries(bundle.manifest.files.map((file) => [file.name, file.rows])),
      latest_alias: `/data/exports/v1/latest/manifest.json`,
      dated: `/data/exports/v1/${bundle.manifest.export_date}/manifest.json`,
    },
    null,
    2,
  ),
);
