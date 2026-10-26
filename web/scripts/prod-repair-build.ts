/**
 * Issue #786, option B, OFFLINE ONLY. Bun 1.4.2; dependencies must be installed
 * in web/ and pipeline/. All arguments are existing local inputs, except --out
 * which must not exist. No environment files, downloads, credentials or writes
 * to a bucket. The original aggregate inputs/manifest.json is lost: read the
 * verified 10-20 backup checkpoints, validate them again, and fingerprint every
 * consumed input. Do not run the old rehearsal metadata synthesizer.
 *
 * Exact Mac commands, from the repository root, AFTER the inputs are retained:
 *   export REPAIR="$PWD/.kanban-work/786-real"
 *   export FROZEN="refresh-2026-09-13T06-00-16-398Z"
 *   bun --no-env-file web/scripts/prod-repair-build.ts \
 *     --frozen-views "$REPAIR/inputs/views/$FROZEN" \
 *     --whitelist "$REPAIR/inputs/canonical/v2/whitelist/refresh-2026-09-23T01-44-09-453Z.json" \
 *     --rest-repos "$REPAIR/inputs/github-rest" \
 *     --gross "$REPAIR/inputs/star_daily_gross" \
 *     --aggregate "$REPAIR/inputs/star-history-agg" \
 *     --out "$REPAIR/repaired" --generation bootstrap-prod-repair-786
 *   jq '{repo_count, rows, dropped, node_id_sources, aggregate}' "$REPAIR/repaired/repair-report.json"
 *
 * github-rest contains retained raw REST repository responses named
 * 99234994.json, 149111813.json, 594330628.json (numeric id + node_id required).
 * star-history-agg is the already verified extraction of
 * backups/2026-10-20/star-history-agg.tar.gz, with repos/<id>.json checkpoints.
 * Gross files are the 22 verified star_daily_gross/*.parquet parts, not a gap
 * export. Frozen views must be the complete locally retained snapshot.
 * Output has both BOOTSTRAP_PHASES and sealed manifests, but no latest pointer.
 * Use prod-repair-compare.ts (#787) for the separate offline comparison.
 * Rehearsal, backup sealing and publication remain separate cards.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOOTSTRAP_PHASES, assertBootstrapGeneration, bootstrapGenerationPrefix,
  buildBootstrapPhaseManifest, verifyBootstrapGeneration,
} from "../../pipeline/lib/bootstrap-publication.mjs";
import { readRepairGrossWeeks } from "../../pipeline/lib/prod-repair-gross.mjs";
import { GAP_DAYS, gapSeries } from "../../pipeline/scripts/star-history-aggregate.mjs";
import {
  CanonicalMeta, Heatmap, Meta, OrgEntity, OrgsLookup, RepoEntity, ReposLookup,
  ReposShard, RepoMonthlyShard, RepoRecentDailyShard, RepoWeeklyShard, SiteDaily, WhitelistSnapshot,
} from "../lib/contracts";
import { AGGREGATE_HISTORY_PROVENANCE, StarHistoryProvenance } from "../lib/contracts/star-history";
import { buildModel, seamPeriods, type RawShards } from "../lib/workflows/recompute/model";
import { computeRepoWindow } from "../lib/workflows/recompute/windows";
import { mergeAggregateBucket, type ImportReport } from "./lib/aggregate-history-import";
import { digest, type AggregateBundle } from "./lib/aggregate-history-input";

export const DROP_IDS = [206462776, 304766583, 824301644, 1278830624];
type Options = { frozenViews: string; whitelist: string; restRepos: string; gross: string; aggregate: string; out: string; generation: string };
type Inventory = Array<{ path: string; bytes: number; sha256: string }>;
type Curve = RepoEntity["curve"]["monthly"];
type Identity = { node_id: string; kind: "retained_whitelist" | "github_rest"; path: string; sha256: string };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }

export function parseRepairArgs(argv: string[]): Options {
  const fields: Record<string, keyof Options> = {
    "--frozen-views": "frozenViews", "--whitelist": "whitelist", "--rest-repos": "restRepos",
    "--gross": "gross", "--aggregate": "aggregate", "--out": "out", "--generation": "generation",
  };
  const options: Partial<Options> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = fields[argv[i]];
    assert(key && !options[key], `Unknown or duplicate argument: ${argv[i]}`);
    const value = argv[++i];
    assert(value && !value.startsWith("--") && !value.includes("://"), `Expected local value for ${argv[i - 1]}`);
    options[key] = value;
  }
  assert(Object.values(fields).every((key) => options[key]), `Required: ${Object.keys(fields).join(" ")}`);
  assertBootstrapGeneration(options.generation);
  return options as Options;
}

function files(root: string): string[] {
  assert(!lstatSync(root).isSymbolicLink(), `Symlink input refused: ${root}`);
  return readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const path = join(root, entry.name);
    assert(!entry.isSymbolicLink(), `Symlink input refused: ${path}`);
    assert(entry.isDirectory() || entry.isFile(), `Non-file input refused: ${path}`);
    return entry.isDirectory() ? files(path) : [path];
  });
}

/** Every consumed file is fingerprinted; backup evidence is not a recreated lost manifest. */
function reader(inventory: Inventory) {
  return (path: string): Buffer => {
    assert(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), `Expected regular local input: ${path}`);
    const body = readFileSync(path);
    inventory.push({ path: resolve(path), bytes: body.length, sha256: digest(body) });
    return body;
  };
}

/** Invert the last gross stock, then the caller checks ALL points with real recompute. */
export function frozenDiscount(curve: Curve, seamMonth: string): number {
  let gross = 0, stock = 0, previous = "";
  for (const [period, flow, total] of curve) {
    assert(/^\d{4}-\d{2}$/.test(period) && period > previous, "Frozen monthly curve must be ordered and unique");
    previous = period;
    if (period <= seamMonth) {
      assert(flow >= 0, "Negative frozen pre-seam monthly flow");
      gross += flow; stock = total;
    }
  }
  assert(gross > 0 || stock === 0, "Frozen monthly stock cannot be inverted from zero gross");
  return gross > 0 ? stock / gross : 0;
}

export function assertFrozenMonths(raw: RawShards, curves: Map<string, Curve>, seamDate: string): void {
  const recomputed = computeRepoWindow(buildModel(raw, seamDate), "month");
  for (const [id, expected] of curves) {
    const actual = (recomputed.byRepo.get(Number(id)) ?? []).map((row) => [row.period, row.flow, row.stock_est]);
    assert(same(actual, expected), `Monthly value differs from frozen curve for repository ${id}`);
  }
}

export async function buildProductionRepair(options: Options) {
  assertBootstrapGeneration(options.generation);
  const out = resolve(options.out);
  assert(!existsSync(out), `Output already exists: ${out}`);
  // Reject overlapping trees before any read or output creation.
  const outputReal = join(realpathSync(dirname(out)), out.slice(dirname(out).length + 1));
  for (const path of [options.frozenViews, options.whitelist, options.restRepos, options.gross, options.aggregate]) {
    assert(!path.includes("://"), "Only local inputs are supported");
    const inputReal = realpathSync(path);
    assert(outputReal !== inputReal && !outputReal.startsWith(`${inputReal}${sep}`) && !inputReal.startsWith(`${outputReal}${sep}`), "Output overlaps an input");
  }
  const inventory: Inventory = [];
  const read = reader(inventory);
  const json = (path: string): unknown => JSON.parse(read(path).toString("utf8"));
  const base = new Map(files(options.frozenViews).map((path) => [relative(options.frozenViews, path).split(sep).join("/"), read(path)]));
  const baseJson = (path: string): unknown => {
    const body = base.get(path); assert(body, `Incomplete frozen snapshot: ${path}`);
    return JSON.parse(body.toString("utf8"));
  };
  const meta = Meta.parse(baseJson("meta.json"));
  assert(meta.seam_date === "2026-05-30", "Option B requires the frozen 2026-05-30 seam");
  assert(meta.folded_through && (meta.generated_at || meta.backfilled_at), "Frozen metadata lacks fold watermarks or timestamp");
  const lookup = ReposLookup.parse(baseJson("lookup/repos.json"));
  assert(Object.keys(lookup).length > 0, "Frozen repository lookup is empty");
  const orgs = OrgsLookup.parse(baseJson("lookup/orgs.json"));
  for (const owner of Object.keys(orgs)) OrgEntity.parse(baseJson(`entity/org/${owner}.json`));
  for (const dim of ["repo", "org"]) baseJson(`rank/all-time/${dim}/stock.json`);

  const identities = new Map<number, Identity>();
  const retain = (id: number, node: string, kind: Identity["kind"], file: Inventory[number]) => {
    assert(typeof node === "string" && /^[A-Za-z0-9_+/=-]+$/.test(node), `Invalid retained node_id for ${id}`);
    const prior = identities.get(id);
    assert(!prior || prior.node_id === node, `Conflicting retained node_id for ${id}`);
    if (!prior) identities.set(id, { node_id: node, kind, path: file.path, sha256: file.sha256 });
  };
  const whitelist = WhitelistSnapshot.parse(json(options.whitelist));
  const whitelistFile = inventory.at(-1)!;
  const whitelistIds = new Set<number>();
  for (const row of whitelist.entries) {
    assert(!whitelistIds.has(row.id), `Duplicate whitelist repository ${row.id}`);
    whitelistIds.add(row.id); retain(row.id, row.node_id, "retained_whitelist", whitelistFile);
  }
  for (const path of files(options.restRepos)) {
    assert(/^\d+\.json$/.test(relative(options.restRepos, path)), "REST inputs must be named <id>.json");
    const row = json(path) as { id: number; node_id: string };
    assert(Number.isSafeInteger(row.id) && row.id > 0 && relative(options.restRepos, path) === `${row.id}.json`, "REST repository identity mismatch");
    retain(row.id, row.node_id, "github_rest", inventory.at(-1)!);
  }
  const raw: RawShards = { repos: {}, monthly: {}, weekly: {}, recentDaily: {}, siteDailyByYear: {} };
  const curves = new Map<string, Curve>();
  const dropped: Array<{ id: number; full_name: string; reason: string }> = [];
  const nodeSources: Record<string, Identity> = {};
  for (const [id, entry] of Object.entries(lookup)) {
    assert(/^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)), `Invalid frozen repository id: ${id}`);
    const entity = RepoEntity.parse(baseJson(`entity/repo/${id}.json`));
    assert(entity.id === Number(id) && entity.full_name === entry.full_name, `Frozen identity mismatch: ${id}`);
    if (DROP_IDS.includes(entity.id)) {
      dropped.push({ id: entity.id, full_name: entity.full_name, reason: "github_rest_404_owner_approved" }); continue;
    }
    const identity = identities.get(entity.id);
    assert(identity, `Missing retained node_id for kept repository ${id}; synthesized node_id fallback is forbidden`);
    nodeSources[id] = identity;
    const d = frozenDiscount(entity.curve.monthly, seamPeriods(meta.seam_date).month);
    const record = ReposShard.parse({ [id]: {
      id: entity.id, node_id: identity.node_id, owner: entity.owner, owner_type: entity.owner_type,
      name: entity.name, full_name: entity.full_name, description: entity.description,
      language: entity.language, languages: entity.languages, topics: entity.topics,
      created_at: entity.created_at, current_stars: entity.current_stars,
      active: entity.active ?? true, is_archived: entity.is_archived, tracked_since: entity.tracked_since ?? null,
      ...entity.milestones, d,
    } })[id]!;
    raw.repos[id] = { ...record, d };
    curves.set(id, entity.curve.monthly);
    raw.monthly[id] = entity.curve.monthly.map(([period, flow]) => [period, flow]);
    assert(entity.curve.recent_daily.every(([day]) => day < meta.seam_date), `Frozen daily tail crosses seam: ${id}`);
    assert(new Set(entity.curve.recent_daily.map(([day]) => day)).size === entity.curve.recent_daily.length, `Duplicate frozen day: ${id}`);
    raw.recentDaily[id] = [...entity.curve.recent_daily].sort(([a], [b]) => a.localeCompare(b));
  }
  assertFrozenMonths(raw, curves, meta.seam_date);

  const grossFiles = files(options.gross).filter((path) => path.endsWith(".parquet"));
  // Hash first and again after DuckDB reads to detect changes during preparation.
  const grossHashes = grossFiles.map((path) => digest(read(path)));
  for (const row of await readRepairGrossWeeks(grossFiles, meta.seam_date)) {
    const id = String(row.id); if (!raw.repos[id]) continue;
    (raw.weekly[id] ??= [] as Array<[string, number]>);
    (raw.weekly[id] as Array<[string, number]>).push([row.period, row.flow]);
  }
  grossFiles.forEach((path, index) => assert(digest(readFileSync(path)) === grossHashes[index], `Gross input changed during read: ${path}`));

  const bundle: AggregateBundle = { sha256: "", daily: {}, weekly: {}, missing: [] };
  const checkpoints = files(join(options.aggregate, "repos"));
  assert(checkpoints.length > 0, "Aggregate backup has no checkpoints");
  const checkpointInventory: Inventory = [];
  for (const path of checkpoints) {
    const row = json(path) as { version: number; repo_id: number; name: string; status: string; provenance: unknown; daily: Record<string, number> | null; total: number };
    assert(row.version === 1 && Number.isSafeInteger(row.repo_id) && row.repo_id > 0 &&
      relative(join(options.aggregate, "repos"), path) === `${row.repo_id}.json`, "Invalid aggregate checkpoint identity");
    StarHistoryProvenance.parse(row.provenance);
    assert(row.status !== "fetching", `Unfinished aggregate checkpoint ${row.repo_id}`);
    checkpointInventory.push({ ...inventory.at(-1)!, path: relative(options.aggregate, path).split(sep).join("/") });
    if (row.status !== "complete") {
      assert(["not_found_or_inaccessible", "http_403", "http_451", "unavailable_empty_history", "incomplete_history"].includes(row.status), "Unknown aggregate checkpoint status");
      bundle.missing.push({ repo_id: row.repo_id, name: row.name, status: row.status }); continue;
    }
    assert(row.daily && same(Object.keys(row.daily).sort(), GAP_DAYS) &&
      Object.values(row.daily).every((count) => Number.isSafeInteger(count) && count >= 0) &&
      Object.values(row.daily).reduce((a, b) => a + b, 0) === row.total, `Invalid aggregate daily coverage or total: ${row.repo_id}`);
    bundle.daily[String(row.repo_id)] = GAP_DAYS.map((day: string) => [day, row.daily![day]]);
    bundle.weekly[String(row.repo_id)] = gapSeries(row).weekly as Array<[string, number]>;
  }
  bundle.sha256 = digest(encode(checkpointInventory));
  const aggregateReport: ImportReport = { source_manifest_sha256: bundle.sha256, generation: options.generation, imported: [], skipped: [], edge_weeks_skipped: [] };
  for (const id of Object.keys(raw.repos)) {
    if (!bundle.daily[id] && !bundle.missing.some((row) => String(row.repo_id) === id)) {
      assert(!curves.get(id)!.some(([month]) => month <= "2026-05"), `Missing aggregate checkpoint for pre-seam repository ${id}`);
    }
  }
  // Use the exact existing merger, including its edge-week and provenance rules.
  const repos = ReposShard.parse(raw.repos);
  const daily = RepoRecentDailyShard.parse(raw.recentDaily);
  const weekly = RepoWeeklyShard.parse(raw.weekly);
  mergeAggregateBucket(repos, daily, weekly, bundle, aggregateReport);
  raw.repos = repos as RawShards["repos"]; raw.recentDaily = daily; raw.weekly = weekly;
  assertFrozenMonths(raw, curves, meta.seam_date);

  // Site daily is copied from month heatmaps, never from aggregate repository days.
  for (const [path] of base) {
    if (!/^heatmap\/month\/\d{4}-\d{2}\.json$/.test(path)) continue;
    const heatmap = Heatmap.parse(baseJson(path));
    assert(path === `heatmap/month/${heatmap.meta.period}.json` && heatmap.meta.scope === "month", "Frozen heatmap identity mismatch");
    for (const [day, count] of heatmap.cells) {
      assert(day.startsWith(`${heatmap.meta.period}-`), "Frozen heatmap day outside month");
      const year = day.slice(0, 4);
      const site = raw.siteDailyByYear[year] ??= { year, cells: [] };
      assert(!site.cells.some(([prior]) => prior === day), `Duplicate frozen heatmap day ${day}`);
      (site.cells as Array<[string, number]>).push([day, count]);
    }
  }
  assert(Object.keys(raw.siteDailyByYear).length > 0, "Incomplete frozen snapshot: no month heatmaps");
  const canonical = new Map<string, Buffer>();
  canonical.set("meta.json", encode(CanonicalMeta.parse({ seam_date: meta.seam_date, schema_ver: meta.schema_ver,
    folded_through: meta.folded_through, generated_at: meta.generated_at ?? meta.backfilled_at })));
  const families = [
    ["repos", raw.repos, ReposShard], ["repo-monthly", raw.monthly, RepoMonthlyShard],
    ["repo-weekly", raw.weekly, RepoWeeklyShard], ["repo-recent-daily", raw.recentDaily, RepoRecentDailyShard],
  ] as const;
  for (const [family, source, schema] of families) {
    for (let bucket = 0; bucket < 32; bucket++) {
      canonical.set(`${family}/${bucket}.json`, encode(schema.parse(Object.fromEntries(
        Object.entries(source).filter(([id]) => Number(id) % 32 === bucket),
      ))));
    }
  }
  for (const [year, site] of Object.entries(raw.siteDailyByYear)) {
    canonical.set(`site-daily/${year}.json`, encode(SiteDaily.parse({ year, cells: [...site.cells].sort(([a], [b]) => a.localeCompare(b)) })));
  }
  const countRows = (source: RawShards["monthly"]) => Object.values(source).reduce((sum, rows) => sum + rows.length, 0);
  const report = {
    version: 1, generation: options.generation, phases: BOOTSTRAP_PHASES,
    repo_count: Object.keys(raw.repos).length, frozen_repo_count: Object.keys(lookup).length,
    rows: { monthly: countRows(raw.monthly), weekly: countRows(raw.weekly), daily: countRows(raw.recentDaily),
      site_daily: Object.values(raw.siteDailyByYear).reduce((sum, site) => sum + site.cells.length, 0) },
    dropped, node_id_sources: nodeSources, monthly_matches_frozen: true,
    base_policy: "byte_for_byte_frozen_snapshot_including_dropped_ids",
    aggregate: { backup_source: "backups/2026-10-20/star-history-agg.tar.gz", original_collector_manifest: "lost",
      verification: "local_checkpoint_contract_coverage_totals_and_sha256_reverified",
      checkpoint_inventory_sha256: bundle.sha256, provenance: AGGREGATE_HISTORY_PROVENANCE,
      imported: aggregateReport.imported, unavailable: bundle.missing, edge_weeks_skipped: aggregateReport.edge_weeks_skipped,
      outside_frozen_membership: Object.keys(bundle.daily).filter((id) => !lookup[id]).map(Number),
      outside_aggregate_membership: Object.keys(raw.repos).filter((id) => !bundle.daily[id] && !bundle.missing.some((row) => String(row.repo_id) === id)).map(Number) },
    inputs: inventory,
  };
  // All refusal checks precede the first output write. No pointer is produced.
  mkdirSync(out);
  const prefix = bootstrapGenerationPrefix(options.generation);
  for (const phase of BOOTSTRAP_PHASES) {
    const items = [...(phase === "base" ? base : canonical)].map(([path, body]) => ({ path: `${phase === "base" ? "views" : "canonical/v2"}/${path}`, body }));
    const manifest = buildBootstrapPhaseManifest(options.generation, phase, items);
    for (const item of [...items, { path: `manifests/${phase}.json`, body: encode(manifest) }]) {
      const target = join(out, prefix, item.path); mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, item.body, { flag: "wx" });
    }
  }
  await verifyBootstrapGeneration({ generation: options.generation, store: { read: async (path: string) => readFileSync(join(out, path)) } });
  writeFileSync(join(out, "repair-report.json"), encode(report), { flag: "wx" });
  return report;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const report = await buildProductionRepair(parseRepairArgs(argv));
  console.log(JSON.stringify({ generation: report.generation, repo_count: report.repo_count, rows: report.rows }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
