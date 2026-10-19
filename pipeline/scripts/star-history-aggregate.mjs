// Local-only gap inputs. GitHub authentication stays inside gh api.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { atomicJson, parseGhResponse, Pause } from "./star-history.mjs";
import { BACKFILL_BUCKETS, bucketOf } from "../lib/backfill-data.mjs";

export const OUTPUT_ROOT = "/Users/ms23m2/AgenticCoder/gitstarclub.com/.kanban-work/leader/star-history-agg";
export const START_DAY = "2026-05-30";
export const END_DAY = "2026-09-30";
export const WHITELIST_SHA256 = "07f5a3b79bb26fe2d248686c1b064b405d1ddd0124f76746dc7e5bd75f2cb4de";
export const PROVENANCE = {
  source: "github_stargazers_history_aggregate",
  api_version: "2026-03-10",
  metric: "surviving_stars_at_query_time",
  day_boundary: "github_calendar_label_approximate_not_guaranteed_utc",
  day_shift: 0,
  week_calendar: "iso_monday_sunday_reaggregated_from_daily",
  monthly_policy: "preserve_published_net_do_not_fold_these_daily_values_into_months",
  start: START_DAY,
  end_inclusive: END_DAY,
};
const VERSION = 1;
const DAY_MS = 86_400_000;
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const count = (n) => Number.isSafeInteger(n) && n >= 0;
const nameValid = (name) => typeof name === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name);
const date = (time) => new Date(time).toISOString().slice(0, 10);
const dayTime = (day) => Date.parse(`${day}T00:00:00Z`);
export const GAP_DAYS = Array.from({ length: 124 }, (_, i) => date(dayTime(START_DAY) + i * DAY_MS));
const HEADER_KEYS = ["date", "link", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "x-ratelimit-resource", "x-github-request-id"];
const safeHeaders = (headers) => Object.fromEntries(HEADER_KEYS.filter((key) => key in headers).map((key) => [key, headers[key]]));

export function fixedMembers(whitelist, metadata, inventory, expected = 5249) {
  const ids = whitelist.map((row) => Number(row.repo_id));
  if (ids.length !== expected || ids.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    throw new Error("Invalid fixed whitelist cardinality or ids");
  }
  return ids.sort((a, b) => a - b).map((id) => {
    const prior = inventory[String(id)];
    const original = metadata[String(id)];
    const name = prior?.name ?? original?.full_name;
    if (!prior || !nameValid(name) || !nameValid(original?.full_name)) throw new Error(`Missing stable-id inventory or repository name for ${id}`);
    return { id, name, original_name: original.full_name, inventory_status: prior.status,
      identity_checked_at: prior.fetched_at, identity_source: "GSC_0080 stable-id GraphQL inventory" };
  });
}

export function historyEndpoint(name, page) {
  if (!nameValid(name) || !Number.isSafeInteger(page) || page < 1 || page > 100) throw new Error("Invalid history GET target");
  return `repos/${name}/stargazers/history?per_page=30&page=${page}`;
}

export async function ghHistory(name, page) {
  const endpoint = historyEndpoint(name, page);
  return new Promise((done) => {
    // No shell, credential lookup, automatic pagination, writes or alternate host.
    const child = spawn("gh", ["api", endpoint, "--hostname", "github.com", "--method", "GET", "--include",
      "-H", "Accept: application/vnd.github+json", "-H", `X-GitHub-Api-Version: ${PROVENANCE.api_version}`], {
      stdio: ["ignore", "pipe", "ignore"], timeout: 60_000,
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; if (stdout.length > 1_000_000) child.kill(); });
    child.on("error", () => done({ status: 0, headers: {}, body: null }));
    child.on("close", (code) => done(parseGhResponse(stdout, code ?? -1)));
  });
}

export function retryDelay(response, attempt, now) {
  const { status, headers, body } = response;
  const primary = headers["x-ratelimit-remaining"] === "0";
  const limited = (primary && status !== 200) || status === 429 || (status !== 200 && Boolean(headers["retry-after"])) ||
    (status === 403 && /rate.?limit|abuse|secondary/i.test(String(body?.message ?? "")));
  if (!limited && status !== 0 && status < 500) return null;
  const retry = headers["retry-after"];
  const retryMs = retry ? (/^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - now) : 0;
  const reset = Number(headers["x-ratelimit-reset"]) * 1000;
  return Math.max((limited ? 60_000 : 1000) * 2 ** attempt,
    Number.isFinite(retryMs) ? retryMs : 0, primary && Number.isFinite(reset) ? reset - now + 1000 : 0);
}

export class AggregateClient {
  constructor({ out, transport = ghHistory, now = Date.now, wait = sleep, deadline = Infinity, log = console.log }) {
    this.out = out;
    this.file = join(out, "api-state.json");
    this.transport = transport;
    this.now = now;
    this.wait = wait;
    this.deadline = deadline;
    this.log = log;
    this.state = existsSync(this.file) ? read(this.file) : {
      requests: 0, api_ms: 0, wait_ms: 0, last_request_at: 0, not_before: 0, retry_key: null, retries: 0,
    };
  }
  save() { atomicJson(this.file, this.state); }
  async request(member, page) {
    const key = `${member.id}:${page}`;
    if (this.state.retry_key !== key) { this.state.retry_key = key; this.state.retries = 0; }
    for (;;) {
      const until = Math.max(this.state.not_before, this.state.last_request_at + 1050);
      if (this.now() >= this.deadline || until >= this.deadline) throw new Pause("Chunk deadline or persisted quota cooldown reached");
      while (this.now() < until) {
        const duration = Math.min(60_000, until - this.now());
        if (duration >= 10_000) this.log(`Quota/backoff wait until ${new Date(until).toISOString()}`);
        await this.wait(duration);
        this.state.wait_ms += duration;
      }
      if (this.now() >= this.deadline) throw new Pause("Chunk deadline reached after waiting");
      if (this.state.retries >= 6) throw new Error("Repeated GitHub errors; retry budget exhausted and cooldown retained");
      // Persist the start before launching gh, including across a process crash.
      this.state.last_request_at = this.now();
      this.state.requests++;
      this.save();
      const response = await this.transport(member.name, page);
      this.state.api_ms += this.now() - this.state.last_request_at;
      const headers = safeHeaders(response.headers);
      this.state.rate = headers;
      const evidence = `pages/${member.id}/${this.state.requests}-page-${page}.json`;
      atomicJson(join(this.out, evidence), { repo_id: member.id, endpoint: historyEndpoint(member.name, page),
        requested_at: new Date(this.state.last_request_at).toISOString(), fetched_at: new Date(this.now()).toISOString(),
        status: response.status, headers, body: Array.isArray(response.body) ? response.body : null });
      const delay = retryDelay(response, this.state.retries, this.now());
      this.state.not_before = delay === null ? 0 : this.now() + delay;
      const remaining = Number(headers["x-ratelimit-remaining"]);
      const reset = Number(headers["x-ratelimit-reset"]) * 1000;
      if (Number.isFinite(remaining) && remaining <= 10 && Number.isFinite(reset)) {
        this.state.not_before = Math.max(this.state.not_before, reset + 1000);
      }
      this.state.retries = delay === null ? 0 : this.state.retries + 1;
      this.save();
      if (delay !== null) continue;
      if (response.status === 401) throw new Error("Existing gh login is unauthorized; no credential changes attempted");
      if (![200, 403, 404, 451].includes(response.status)) throw new Error(`History request failed (HTTP ${response.status}); inspect sanitized page evidence`);
      return { ...response, headers, evidence };
    }
  }
}

export function newCheckpoint(member) {
  return { version: VERSION, repo_id: member.id, name: member.name, provenance: PROVENANCE,
    status: "fetching", next_page: 1, pages: [], oldest_week: null, daily: {}, started_at: new Date().toISOString() };
}

export function consumePage(previous, response) {
  const next = structuredClone(previous);
  next.pages.push(response.evidence);
  if (response.status !== 200) {
    return { ...next, status: response.status === 404 ? "not_found_or_inaccessible" : `http_${response.status}`, daily: null };
  }
  const linkedIds = [...(response.headers.link ?? "").matchAll(/https:\/\/api\.github\.com\/repositories\/(\d+)\/stargazers\/history/g)].map((match) => Number(match[1]));
  if (linkedIds.some((id) => id !== next.repo_id)) throw new Error("History pagination identity differs from the fixed repository id");
  next.response_identity = linkedIds.length ? "stable_id_from_pagination_link" : "same_day_stable_id_inventory_name";
  const weeks = response.body;
  if (!Array.isArray(weeks) || weeks.length > 30) throw new Error("Invalid aggregate response shape");
  if (!weeks.length) return { ...next, status: "unavailable_empty_history", daily: null };
  let previousWeek = next.oldest_week;
  for (const row of weeks) {
    const time = row.week * 1000;
    if (!count(row.week) || !Number.isFinite(time) || time > 8.64e15 || new Date(time).getUTCDay() !== 0 || time % DAY_MS !== 0 ||
        !count(row.total) || !Array.isArray(row.days) || row.days.length !== 7 || row.days.some((n) => !count(n)) ||
        row.days.reduce((a, b) => a + b, 0) !== row.total) throw new Error("Malformed Sunday-labeled aggregate week or total");
    if (previousWeek !== null && previousWeek - row.week !== 7 * 86400) throw new Error("History weeks are duplicated, missing or not newest-first");
    previousWeek = row.week;
    row.days.forEach((value, index) => {
      const label = date(time + index * DAY_MS);
      if (label >= START_DAY && label <= END_DAY) {
        if (label in next.daily) throw new Error("Duplicate daily label");
        next.daily[label] = value;
      }
    });
  }
  next.oldest_week = previousWeek;
  next.next_page++;
  if (GAP_DAYS.every((day) => count(next.daily[day]))) {
    next.status = "complete";
    next.daily = Object.fromEntries(GAP_DAYS.map((day) => [day, next.daily[day]]));
    next.total = Object.values(next.daily).reduce((a, b) => a + b, 0);
  } else if (date(previousWeek * 1000) <= START_DAY || !/rel="next"/.test(response.headers.link ?? "")) {
    next.status = "incomplete_history";
    next.daily = null;
  }
  return next;
}

export function loadCheckpoint(out, member) {
  const file = join(out, "repos", `${member.id}.json`);
  if (!existsSync(file)) return newCheckpoint(member);
  const record = read(file);
  if (record.version !== VERSION || record.repo_id !== member.id || record.name !== member.name ||
      JSON.stringify(record.provenance) !== JSON.stringify(PROVENANCE)) throw new Error("Checkpoint contract mismatch");
  if (record.status === "complete" && (Object.keys(record.daily ?? {}).length !== GAP_DAYS.length ||
      !GAP_DAYS.every((day) => count(record.daily[day])) || record.total !== Object.values(record.daily).reduce((a, b) => a + b, 0))) {
    throw new Error("Invalid completed daily checkpoint");
  }
  return record;
}

export function summarize(out, members) {
  const statuses = {};
  const missing = [];
  let repositoryDays = 0;
  let observedTotal = 0;
  for (const member of members) {
    const record = loadCheckpoint(out, member);
    statuses[record.status] = (statuses[record.status] ?? 0) + 1;
    if (record.status === "complete") { repositoryDays += GAP_DAYS.length; observedTotal += record.total; }
    else missing.push({ repo_id: member.id, name: member.name, status: record.status });
  }
  return { repositories: members.length, statuses, repository_days: repositoryDays, expected_repository_days: members.length * GAP_DAYS.length,
    observed_surviving_stars: observedTotal, full_whitelist_surviving_stars: missing.length ? null : observedTotal,
    coverage_complete: missing.length === 0, fetch_finished: !(statuses.fetching > 0), missing, provenance: PROVENANCE };
}

export async function runFetch({ out, members, client, maxRepos = Infinity }) {
  let processed = 0;
  let paused = null;
  try {
    for (const member of members) {
      let record = loadCheckpoint(out, member);
      if (record.status !== "fetching") continue;
      if (processed >= maxRepos) { paused = "Repository chunk limit reached"; break; }
      while (record.status === "fetching") {
        const response = await client.request(member, record.next_page);
        record = { ...consumePage(record, response), fetched_at: new Date(client.now()).toISOString() };
        atomicJson(join(out, "repos", `${member.id}.json`), record);
      }
      processed++;
      client.log(`Repository ${member.id} ${record.status}; processed this chunk ${processed}`);
    }
  } catch (error) { if (!(error instanceof Pause)) throw error; paused = error.message; }
  const result = { ...summarize(out, members), processed_this_chunk: processed, paused };
  atomicJson(join(out, "summary.json"), result);
  return result;
}

export function isoWeek(day) {
  const d = new Date(dayTime(day));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function gapSeries(record) {
  if (record.status !== "complete") throw new Error("Only complete daily coverage can be exported");
  const daily = GAP_DAYS.map((day) => [day, record.daily[day]]);
  if (daily.some(([, value]) => !count(value))) throw new Error("Missing or invalid daily observation");
  const weeks = new Map();
  for (const [day, value] of daily) {
    const key = isoWeek(day);
    const group = weeks.get(key) ?? { period: key, sum: 0, days: [] };
    group.sum += value;
    group.days.push(day);
    weeks.set(key, group);
  }
  return { daily, weekly: [...weeks.values()].filter((week) => week.days.length === 7).map((week) => [week.period, week.sum]),
    partialWeeks: [...weeks.values()].filter((week) => week.days.length !== 7) };
}

export function replayEvidence(out, member, record) {
  let replayed = newCheckpoint(member);
  for (const path of record.pages) replayed = consumePage(replayed, { ...read(join(out, path)), evidence: path });
  if (replayed.status !== record.status || JSON.stringify(replayed.daily) !== JSON.stringify(record.daily) || replayed.total !== record.total) {
    throw new Error(`Raw evidence does not reproduce checkpoint ${member.id}`);
  }
  return replayed.response_identity ?? "unavailable";
}

export function exportInputs(out, members) {
  const summary = summarize(out, members);
  if (!summary.fetch_finished) throw new Error("Finish the fixed-whitelist sweep before exporting");
  const dailyBuckets = Array.from({ length: BACKFILL_BUCKETS }, () => ({}));
  const weeklyBuckets = Array.from({ length: BACKFILL_BUCKETS }, () => ({}));
  const partial = {};
  const files = [];
  let dailyRows = 0;
  let weeklyRows = 0;
  for (const member of members) {
    const record = loadCheckpoint(out, member);
    if (record.status !== "complete") continue;
    const series = gapSeries(record);
    dailyBuckets[bucketOf(member.id)][member.id] = series.daily;
    weeklyBuckets[bucketOf(member.id)][member.id] = series.weekly;
    partial[member.id] = series.partialWeeks;
    dailyRows += series.daily.length;
    weeklyRows += series.weekly.length;
  }
  const write = (path, payload, rows) => {
    const file = join(out, "inputs", path);
    atomicJson(file, payload);
    const bytes = readFileSync(file);
    files.push({ path, bytes: bytes.length, sha256: sha256(bytes), rows });
  };
  for (let bucket = 0; bucket < BACKFILL_BUCKETS; bucket++) {
    write(`canonical/v2/repo-recent-daily/${bucket}.json`, dailyBuckets[bucket], Object.values(dailyBuckets[bucket]).reduce((n, rows) => n + rows.length, 0));
    write(`canonical/v2/repo-weekly/${bucket}.json`, weeklyBuckets[bucket], Object.values(weeklyBuckets[bucket]).reduce((n, rows) => n + rows.length, 0));
  }
  write("partial-iso-weeks.json", partial, Object.values(partial).reduce((n, rows) => n + rows.length, 0));
  const checkpoints = members.map((member) => {
    const path = `repos/${member.id}.json`;
    const bytes = readFileSync(join(out, path));
    const record = JSON.parse(bytes.toString());
    return { repo_id: member.id, path, sha256: sha256(bytes), status: record.status,
      raw_replay_verified: true, response_identity: replayEvidence(out, member, record),
      pages: record.pages.map((path) => ({ path, sha256: sha256(readFileSync(join(out, path))) })) };
  });
  const source = read(join(out, "manifest.json"));
  const rawResponses = existsSync(join(out, "pages")) ? readdirSync(join(out, "pages"), { recursive: true })
    .map(String).filter((path) => path.endsWith(".json")).sort().map((path) => {
      const relative = `pages/${path}`;
      const bytes = readFileSync(join(out, relative));
      return { path: relative, bytes: bytes.length, sha256: sha256(bytes) };
    }) : [];
  const manifest = { version: VERSION, local_only: true, merge_policy: "gap-only inputs; fill missing dates/weeks only; never replace existing observations",
    ...summary, daily_rows: dailyRows, complete_week_rows: weeklyRows,
    daily_periods: GAP_DAYS, complete_week_periods: [...new Set(GAP_DAYS.map(isoWeek))].filter((week) => GAP_DAYS.filter((day) => isoWeek(day) === week).length === 7),
    partial_week_policy: "Do not publish partial totals as whole weeks; join adjacent existing daily observations in a separate integration",
    monthly_files: [], files, checkpoints, raw_responses: rawResponses, source_manifest_sha256: sha256(readFileSync(join(out, "manifest.json"))), sources: source.sources,
    measurements: existsSync(join(out, "api-state.json")) ? read(join(out, "api-state.json")) : null };
  atomicJson(join(out, "inputs", "manifest.json"), manifest);
  return { ...summary, daily_rows: dailyRows, complete_week_rows: weeklyRows, files: files.length, manifest_sha256: sha256(readFileSync(join(out, "inputs", "manifest.json"))) };
}

function prepare(out, flags) {
  const sources = Object.fromEntries(["whitelist", "metadata", "inventory"].map((key) => {
    if (!flags[key]) throw new Error(`Missing --${key}`);
    return [key, { path: resolve(flags[key]), sha256: sha256(readFileSync(flags[key])) }];
  }));
  if (sources.whitelist.sha256 !== WHITELIST_SHA256) throw new Error("Whitelist differs from the verified 5249-row R2-equivalent JSON");
  const members = fixedMembers(read(flags.whitelist), read(flags.metadata), read(flags.inventory));
  const manifest = { version: VERSION, provenance: PROVENANCE, sources, members,
    whitelist_origin: "R2 gitstarclub-raw/bigquery-export/whitelist/data-000000000000.parquet; retained JSON id-set equality verified by GSC_0080" };
  const file = join(out, "manifest.json");
  if (existsSync(file) && JSON.stringify(read(file)) !== JSON.stringify(manifest)) throw new Error("Existing collection uses different inputs");
  atomicJson(file, manifest);
  return { repositories: members.length, sources };
}

export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (!command || command === "--help") {
    console.log("star-history-aggregate.mjs prepare|fetch|report|export [--max-seconds 540] [--max-repos N]\nprepare requires --whitelist RETAINED_JSON --metadata RETAINED_REPOS_JSON --inventory STABLE_ID_INVENTORY_JSON\nOnly serial gh api GETs. Fixed local output; no uploads, monthly reconstruction or UTC claims.");
    return 0;
  }
  if (!["prepare", "fetch", "report", "export"].includes(command)) throw new Error("Unknown command");
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i].replace(/^--/, "");
    if (!rest[i].startsWith("--") || !["whitelist", "metadata", "inventory", "max-seconds", "max-repos"].includes(key) || key in flags) throw new Error("Invalid or repeated option");
    flags[key] = rest[++i];
    if (!flags[key] || flags[key].startsWith("--")) throw new Error("Missing option value");
  }
  for (const key of ["max-seconds", "max-repos"]) {
    if (key in flags && (!Number.isSafeInteger(Number(flags[key])) || Number(flags[key]) <= 0)) throw new Error(`Invalid ${key}`);
  }
  if (Number(flags["max-seconds"] ?? 540) > 540) throw new Error("Foreground chunks are capped at 540 seconds plus one in-flight request");
  mkdirSync(OUTPUT_ROOT, { recursive: true });
  if (realpathSync(OUTPUT_ROOT) !== OUTPUT_ROOT) throw new Error("Output directory must not be redirected by a symlink");
  const lock = join(OUTPUT_ROOT, ".collector-lock");
  if (existsSync(lock)) {
    const pid = read(join(lock, "owner.json")).pid;
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid collector lock");
    try { process.kill(pid, 0); throw new Error("Another collector is running"); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; }
    rmSync(lock, { recursive: true });
  }
  mkdirSync(lock);
  atomicJson(join(lock, "owner.json"), { pid: process.pid });
  try {
    if (command === "prepare") { console.log(JSON.stringify(prepare(OUTPUT_ROOT, flags))); return 0; }
    const manifest = read(join(OUTPUT_ROOT, "manifest.json"));
    if (manifest.version !== VERSION || manifest.members.length !== 5249 || manifest.sources.whitelist.sha256 !== WHITELIST_SHA256 ||
        JSON.stringify(manifest.provenance) !== JSON.stringify(PROVENANCE) || new Set(manifest.members.map((member) => member.id)).size !== 5249) throw new Error("Manifest contract mismatch");
    const whitelistBytes = readFileSync(manifest.sources.whitelist.path);
    if (sha256(whitelistBytes) !== WHITELIST_SHA256 || JSON.stringify(JSON.parse(whitelistBytes.toString()).map((row) => Number(row.repo_id)).sort((a, b) => a - b)) !==
        JSON.stringify(manifest.members.map((member) => member.id))) throw new Error("Manifest membership differs from the pinned whitelist");
    let result;
    if (command === "fetch") {
      const client = new AggregateClient({ out: OUTPUT_ROOT, deadline: Date.now() + Number(flags["max-seconds"] ?? 540) * 1000 });
      result = await runFetch({ out: OUTPUT_ROOT, members: manifest.members, client, maxRepos: Number(flags["max-repos"] ?? Infinity) });
    } else if (command === "export") result = exportInputs(OUTPUT_ROOT, manifest.members);
    else { result = summarize(OUTPUT_ROOT, manifest.members); atomicJson(join(OUTPUT_ROOT, "summary.json"), result); }
    console.log(JSON.stringify(result));
    return result.fetch_finished ? 0 : 2;
  } finally { rmSync(lock, { recursive: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
