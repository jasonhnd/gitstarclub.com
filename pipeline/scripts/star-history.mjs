// Read-only, fixed-whitelist collection. Authentication stays inside gh.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const OUTPUT_ROOT = "/Users/ms23m2/AgenticCoder/gitstarclub.com/.kanban-work/leader/star-history";
export const START = "2026-05-30T00:00:00.000Z";
export const END = "2026-10-01T00:00:00.000Z";
export const METRIC = "surviving_stars_at_query_time; lower_bound_on_gross_adds; unstars_unobservable";
const VERSION = 1;
const RATE = "rateLimit { limit remaining cost resetAt }";
const FIELDS = "id databaseId nameWithOwner isPrivate stargazerCount";
export const INVENTORY_QUERY = `query($ids:[ID!]!) { nodes(ids:$ids) { ... on Repository { ${FIELDS} } } ${RATE} }`;
export const HISTORY_QUERY = `query($id:ID!,$after:String) {
  node(id:$id) { ... on Repository { ${FIELDS}
    stargazers(first:100,after:$after,orderBy:{field:STARRED_AT,direction:DESC}) {
      totalCount edges { cursor starredAt } pageInfo { hasNextPage endCursor }
    }
  } } ${RATE}
}`;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const positiveId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const nonnegative = (value) => Number.isSafeInteger(value) && value >= 0;
const nodeId = (id) => Buffer.from(`010:Repository${id}`).toString("base64");

export function atomicJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.next`;
  writeFileSync(temporary, JSON.stringify(value) + "\n", { mode: 0o600 });
  renameSync(temporary, file);
}

export function fixedMembers(rows, metadata, samples, references, expected = 5249) {
  const ids = rows.map((row) => Number(row.repo_id));
  if (ids.length !== expected || ids.some((id) => !positiveId(id)) || new Set(ids).size !== ids.length) {
    throw new Error("Invalid fixed whitelist cardinality or ids");
  }
  const sampleIds = samples.map((row) => Number(row.id));
  if (sampleIds.length !== 40 || new Set(sampleIds).size !== 40 || sampleIds.some((id) => !ids.includes(id))) {
    throw new Error("The pilot requires exactly the 40 original whitelisted GSC_0045 samples");
  }
  const extras = ids.filter((id) => !sampleIds.includes(id))
    .sort((a, b) => sha(`GSC_0080:${a}`).localeCompare(sha(`GSC_0080:${b}`))).slice(0, 10);
  if (extras.length !== 10) throw new Error("The pilot requires ten extra whitelist members");
  const reference = new Map(references.map((row) => [Number(row.repo_id), row]));
  const members = ids.sort((a, b) => a - b).map((id) => {
    const repo = metadata[String(id)];
    const prior = reference.get(id);
    if (sampleIds.includes(id) && (!prior || !nonnegative(prior.github_history_proxy))) {
      throw new Error("Missing GSC_0045 sample reference");
    }
    return {
      id, node_id: nodeId(id), original_name: repo?.full_name ?? null,
      frozen_stars: repo?.current_stars ?? null,
      sample: sampleIds.includes(id), pilot: sampleIds.includes(id) || extras.includes(id),
      reference_history: prior?.github_history_proxy ?? null,
      reference_archive: prior?.archive_gross ?? null,
    };
  });
  if (members.filter((repo) => repo.sample).reduce((sum, repo) => sum + repo.reference_history, 0) !== 342659) {
    throw new Error("GSC_0045 reference must sum to 342659");
  }
  return members;
}

export function parseGhResponse(stdout, code = 0) {
  const boundary = stdout.search(/\r?\n\r?\n/);
  if (!stdout.startsWith("HTTP/") || boundary < 0) return { status: 0, headers: {}, body: null, code };
  const head = stdout.slice(0, boundary);
  const headers = Object.fromEntries(head.split(/\r?\n/).slice(1).flatMap((line) => {
    const colon = line.indexOf(":");
    return colon < 0 ? [] : [[line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()]];
  }));
  let body = null;
  try { body = JSON.parse(stdout.slice(boundary).trim()); } catch { /* Never persist raw CLI diagnostics. */ }
  return { status: Number(head.split(" ")[1]), headers, body, code };
}

export async function ghGraphql(query, variables) {
  if (![INVENTORY_QUERY, HISTORY_QUERY].includes(query)) throw new Error("Only the two read-only queries are permitted");
  // No shell, token lookup, alternate HTTP client, pagination helper or mutation.
  return new Promise((done) => {
    const child = spawn("gh", ["api", "graphql", "--hostname", "github.com", "--include", "--input", "-"], {
      stdio: ["pipe", "pipe", "ignore"], timeout: 60_000,
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 4_000_000) child.kill();
    });
    child.on("error", () => done({ status: 0, headers: {}, body: null, code: -1 }));
    child.on("close", (code) => done(parseGhResponse(stdout, code ?? -1)));
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ query, variables }));
  });
}

export class Pause extends Error {}

export function retryDelay(response, attempt, now) {
  const { status, headers, body } = response;
  const errors = body?.errors ?? [];
  const message = errors.map((error) => `${error.type ?? ""} ${error.message ?? ""}`).join(" ");
  const primary = headers["x-ratelimit-remaining"] === "0" || body?.data?.rateLimit?.remaining === 0;
  const limited = primary || status === 429 || (status === 403 && Boolean(headers["retry-after"])) || /rate.?limit|abuse|secondary/i.test(message);
  if (!limited && status !== 0 && status < 500) return null;
  const retry = headers["retry-after"];
  const retryMs = retry ? (/^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - now) : 0;
  const reset = headers["x-ratelimit-reset"] ? Number(headers["x-ratelimit-reset"]) * 1000 : Date.parse(body?.data?.rateLimit?.resetAt);
  return Math.max(0, Number.isFinite(retryMs) ? retryMs : 0,
    primary && Number.isFinite(reset) ? reset - now + 1000 : 0,
    (limited ? 60_000 : 1000) * 2 ** attempt);
}

export class GraphqlClient {
  constructor({ out, transport = ghGraphql, now = Date.now, wait = sleep, intervalMs = 1000, deadline = Infinity, log = console.log }) {
    this.file = join(out, "api-state.json");
    this.transport = transport;
    this.now = now;
    this.wait = wait;
    this.intervalMs = intervalMs;
    this.deadline = deadline;
    this.log = log;
    this.state = existsSync(this.file) ? read(this.file) : {
      requests: 0, points: 0, unmetered: 0, api_ms: 0, wait_ms: 0, not_before: 0, last_request_at: 0,
    };
  }
  save() { atomicJson(this.file, this.state); }
  async request(query, variables) {
    for (let attempt = 0; ; attempt++) {
      const until = Math.max(this.state.not_before, this.state.last_request_at + this.intervalMs);
      if (this.now() >= this.deadline || until >= this.deadline) throw new Pause("Chunk time budget or persisted cooldown reached");
      while (this.now() < until) {
        const duration = Math.min(60_000, until - this.now());
        if (duration >= 10_000) this.log(`Waiting until ${new Date(until).toISOString()} (quota/backoff)`);
        await this.wait(duration);
        this.state.wait_ms += duration;
      }
      this.state.last_request_at = this.now();
      const response = await this.transport(query, variables);
      this.state.requests++;
      this.state.api_ms += this.now() - this.state.last_request_at;
      const rate = response.body?.data?.rateLimit;
      if (nonnegative(rate?.cost)) this.state.points += rate.cost;
      else this.state.unmetered++;
      if (rate) this.state.rate = rate;
      const delay = retryDelay(response, attempt, this.now());
      this.state.not_before = delay === null ? 0 : this.now() + delay;
      if (rate && rate.remaining <= 10 && Number.isFinite(Date.parse(rate.resetAt))) {
        this.state.not_before = Math.max(this.state.not_before, Date.parse(rate.resetAt) + 1000);
      }
      this.save();
      if (delay !== null) {
        if (attempt >= 5) throw new Error("GitHub retry budget exhausted; cooldown preserved");
        continue;
      }
      if (response.status === 401) throw new Error("Existing gh login is not authorized; no credential changes attempted");
      if (response.status < 200 || response.status >= 300 || !response.body?.data) {
        throw new Error(`GitHub query failed (HTTP ${response.status}); no raw diagnostics retained`);
      }
      return response;
    }
  }
}

function repositoryIdentity(node, member) {
  if (node === null) return "not_found_or_inaccessible";
  if (!node || Number(node.databaseId) !== member.id || typeof node.id !== "string" || !node.id ||
      typeof node.nameWithOwner !== "string" || typeof node.isPrivate !== "boolean" || !nonnegative(node.stargazerCount)) {
    throw new Error("Repository identity or stock is invalid");
  }
  return node.isPrivate ? "private" : "public";
}

function repositoryErrors(body, field, index = undefined) {
  const errors = body.errors ?? [];
  return errors.filter((error) => {
    if (error.path?.[0] !== field || (index !== undefined && error.path?.[1] !== index) ||
        !["NOT_FOUND", "FORBIDDEN"].includes(error.type)) throw new Error("Unexpected/partial GraphQL error; checkpoint retained");
    return true;
  });
}

export async function inventory({ out, members, client }) {
  const file = join(out, "inventory.json");
  const records = existsSync(file) ? read(file) : {};
  const pending = members.filter((member) => !records[member.id]);
  for (let offset = 0; offset < pending.length; offset += 100) {
    const batch = pending.slice(offset, offset + 100);
    const response = await client.request(INVENTORY_QUERY, { ids: batch.map((member) => member.node_id) });
    const body = response.body;
    if (!Array.isArray(body.data.nodes) || body.data.nodes.length !== batch.length) throw new Error("Truncated inventory response");
    // Validate all error paths before accepting any node in this batch.
    for (const error of body.errors ?? []) {
      if (error.path?.[0] !== "nodes" || !Number.isInteger(error.path[1]) || error.path[1] < 0 || error.path[1] >= batch.length ||
          !["NOT_FOUND", "FORBIDDEN"].includes(error.type)) throw new Error("Unexpected inventory GraphQL error");
    }
    batch.forEach((member, index) => {
      const node = body.data.nodes[index];
      const errors = (body.errors ?? []).filter((error) => error.path[1] === index);
      const status = errors.length ? (errors.some((error) => error.type === "FORBIDDEN") ? "forbidden" : "not_found_or_inaccessible") : repositoryIdentity(node, member);
      records[member.id] = { status, ...(node ? { node_id: node.id, name: node.nameWithOwner, stargazer_count: node.stargazerCount } : {}),
        fetched_at: new Date(client.now()).toISOString() };
    });
    atomicJson(file, records);
    client.log(`Inventory ${Object.keys(records).length}/${members.length}`);
  }
  return records;
}

export function newCheckpoint(member) {
  return { version: VERSION, repo_id: member.id, metric: METRIC, start: START, end_exclusive: END,
    status: "fetching", cursor: null, pages: 0, scanned: 0, daily: {}, seen: [],
    last_time: null, source_total: null, started_at: new Date().toISOString(), name: member.original_name };
}

export function consumePage(previous, node, member) {
  const next = structuredClone(previous);
  const identity = repositoryIdentity(node, member);
  if (identity !== "public") return { ...next, status: identity, daily: null };
  next.name = node.nameWithOwner;
  next.renamed = Boolean(member.original_name && member.original_name !== node.nameWithOwner);
  next.node_id = node.id;
  next.stargazer_count = node.stargazerCount;
  const connection = node.stargazers;
  if (!connection || !nonnegative(connection.totalCount) || !Array.isArray(connection.edges) || connection.edges.length > 100 ||
      typeof connection.pageInfo?.hasNextPage !== "boolean") throw new Error("Malformed stargazer connection");
  if (!connection.edges.length && node.stargazerCount > 0) {
    return { ...next, status: "unavailable_empty_history", daily: null, connection_total: connection.totalCount };
  }
  if (connection.totalCount !== node.stargazerCount) return { ...next, status: "unavailable_count_mismatch", daily: null, connection_total: connection.totalCount };
  if (next.source_total !== null && next.source_total !== connection.totalCount) return { ...next, status: "source_changed", daily: null };
  next.source_total = connection.totalCount;
  const seen = new Set(next.seen);
  let stopped = false;
  for (const edge of connection.edges) {
    if (typeof edge.cursor !== "string" || !edge.cursor || seen.has(edge.cursor) ||
        typeof edge.starredAt !== "string" || !/T.*(Z|[+-]\d\d:\d\d)$/.test(edge.starredAt) || !Number.isFinite(Date.parse(edge.starredAt))) {
      throw new Error("Invalid timestamp or repeated stargazer cursor");
    }
    const time = new Date(edge.starredAt).toISOString();
    if (next.last_time !== null && time > next.last_time) throw new Error("Stargazers are not STARRED_AT descending");
    seen.add(edge.cursor);
    next.last_time = time;
    next.scanned++;
    if (time < START) stopped = true;
    if (time >= START && time < END) {
      const day = time.slice(0, 10);
      next.daily[day] = (next.daily[day] ?? 0) + 1;
    }
  }
  const { hasNextPage, endCursor } = connection.pageInfo;
  if (connection.edges.length && endCursor !== connection.edges.at(-1).cursor) throw new Error("Page cursor does not match its final edge");
  if (hasNextPage && (!connection.edges.length || !endCursor || endCursor === previous.cursor)) throw new Error("Pagination did not advance");
  if (next.scanned > connection.totalCount || (!hasNextPage && next.scanned !== connection.totalCount)) throw new Error("Truncated/inconsistent stargazer history");
  next.pages++;
  next.cursor = endCursor;
  next.seen = [...seen];
  if (stopped || !hasNextPage) {
    next.status = "complete";
    next.stop_reason = stopped ? "before_start" : "exhausted";
    next.daily = Object.fromEntries(Array.from({ length: 124 }, (_, i) => {
      const day = new Date(Date.parse(START) + i * 86400_000).toISOString().slice(0, 10);
      return [day, next.daily[day] ?? 0];
    }));
    next.total = Object.values(next.daily).reduce((sum, count) => sum + count, 0);
    // Cursors identify pagination positions only; no user identities are queried.
    delete next.seen;
  }
  return next;
}

export async function fetchRepository({ out, member, client, retryUnavailable = false }) {
  const file = join(out, "repos", `${member.id}.json`);
  let state = existsSync(file) ? read(file) : newCheckpoint(member);
  if (state.repo_id !== member.id || state.version !== VERSION || state.start !== START || state.end_exclusive !== END) throw new Error("Checkpoint contract mismatch");
  if (state.status === "complete" || (state.status !== "fetching" && !retryUnavailable)) return state;
  if (state.status !== "fetching") state = newCheckpoint(member);
  atomicJson(file, state);
  while (state.status === "fetching") {
    const response = await client.request(HISTORY_QUERY, { id: state.node_id ?? member.node_id, after: state.cursor });
    const errors = repositoryErrors(response.body, "node");
    const before = state;
    if (errors.length) {
      state = { ...state, status: errors.some((error) => error.type === "FORBIDDEN") ? "forbidden" : "not_found_or_inaccessible", daily: null };
    } else {
      try { state = consumePage(state, response.body.data.node, member); }
      catch { state = { ...before, status: "invalid_history", daily: null }; }
    }
    state.updated_at = new Date(client.now()).toISOString();
    state.last_rate = response.body.data.rateLimit ?? null;
    state.last_response_date = response.headers.date ?? null;
    // Preserve query-time, identity-free evidence, then atomically advance counts/cursor together.
    atomicJson(join(out, "pages", String(member.id), `${String(before.pages).padStart(7, "0")}.json`), {
      fetched_at: state.updated_at, after: before.cursor, status: response.status,
      node: response.body.data.node, error_types: errors.map((error) => error.type), rate: state.last_rate,
      response_date: state.last_response_date,
    });
    atomicJson(file, state);
  }
  client.log(`${member.id} ${state.name ?? member.original_name ?? "unknown"} ${state.status}${state.status === "complete" ? ` ${state.total}` : ""}`);
  return state;
}

export function summarize(out, members) {
  const records = members.map((member) => ({ member, result: existsSync(join(out, "repos", `${member.id}.json`)) ? read(join(out, "repos", `${member.id}.json`)) : null }));
  const statuses = {};
  for (const { result } of records) statuses[result?.status ?? "pending"] = (statuses[result?.status ?? "pending"] ?? 0) + 1;
  const complete = records.filter(({ result }) => result?.status === "complete");
  const samples = records.filter(({ member }) => member.sample);
  const matched = samples.filter(({ result }) => result?.status === "complete");
  return {
    version: VERSION, metric: METRIC, start: START, end_exclusive: END, generated_at: new Date().toISOString(),
    repositories: members.length, statuses, verified_repositories: complete.length, verified_repo_days: complete.length * 124,
    verified_surviving_stars: complete.reduce((sum, { result }) => sum + result.total, 0),
    complete: complete.length === members.length,
    measurements: records.map(({ member, result }) => ({ repo_id: member.id, status: result?.status ?? "pending", pages: result?.pages ?? 0 })),
    comparison: {
      sample_repositories: samples.length, matched_repositories: matched.length,
      reference_history_total: samples.reduce((sum, { member }) => sum + member.reference_history, 0),
      reference_archive_total: samples.reduce((sum, { member }) => sum + member.reference_archive, 0),
      matched_graphql_total: matched.length ? matched.reduce((sum, { result }) => sum + result.total, 0) : null,
      matched_reference_total: matched.length ? matched.reduce((sum, { member }) => sum + member.reference_history, 0) : null,
      // No percentage difference is valid when the histories are unavailable.
      rows: samples.map(({ member, result }) => ({ repo_id: member.id, name: result?.name ?? member.original_name,
        status: result?.status ?? "pending", graphql_total: result?.status === "complete" ? result.total : null,
        reference_history: member.reference_history, reference_archive: member.reference_archive })),
    },
  };
}

export function estimate({ members, inventories, pilot, api, intervalMs = 1000 }) {
  const publicRepos = members.filter((member) => inventories[member.id]?.status === "public");
  const stock = publicRepos.reduce((sum, member) => sum + inventories[member.id].stargazer_count, 0);
  const worstPages = publicRepos.reduce((sum, member) => sum + Math.max(1, Math.ceil(inventories[member.id].stargazer_count / 100)), 0);
  const secondsPerRequest = (api.requests ? api.api_ms / api.requests : 0) / 1000 + intervalMs / 1000;
  const pointsPerRequest = api.requests > api.unmetered ? api.points / (api.requests - api.unmetered) : null;
  const band = (member) => member.frozen_stars >= 100000 ? 4 : member.frozen_stars >= 40000 ? 3 : member.frozen_stars >= 20000 ? 2 : member.frozen_stars >= 10000 ? 1 : 0;
  const verified = new Map((pilot.measurements ?? []).filter((row) => row.status === "complete").map((row) => [row.repo_id, row]));
  const strata = Array.from({ length: 5 }, (_, index) => {
    const population = publicRepos.filter((member) => band(member) === index);
    const sample = population.filter((member) => verified.has(member.id));
    const sampleStock = sample.reduce((sum, member) => sum + inventories[member.id].stargazer_count, 0);
    const samplePages = sample.reduce((sum, member) => sum + verified.get(member.id).pages, 0);
    const ratio = sampleStock ? samplePages / sampleStock : null;
    return { band: index, population: population.length, verified_sample: sample.length,
      projected_pages: population.reduce((sum, member) => sum + (ratio === null
        ? Math.max(1, Math.ceil(inventories[member.id].stargazer_count / 100))
        : Math.max(1, Math.ceil(inventories[member.id].stargazer_count * ratio))), 0) };
  });
  const projectedPages = pilot.complete ? strata.reduce((sum, row) => sum + row.projected_pages, 0) : null;
  return {
    inventory_repositories: Object.keys(inventories).length, public_repositories: publicRepos.length, current_stargazer_count: stock,
    pilot_repositories: pilot.repositories, verified_pilot_repositories: pilot.verified_repositories,
    measured_requests: api.requests, measured_points: api.points, unmetered_requests: api.unmetered,
    measured_api_seconds: api.api_ms / 1000, measured_wait_seconds: api.wait_ms / 1000,
    measured_points_per_request: pointsPerRequest, projected_seconds_per_request: secondsPerRequest,
    // Empty/restricted pilots cannot estimate how far paging will need to go.
    measured_pilot_wall_seconds: api.wall_ms === undefined ? null : api.wall_ms / 1000,
    estimated_gap_history_requests: projectedPages,
    estimated_gap_history_points: projectedPages === null || pointsPerRequest === null ? null : projectedPages * pointsPerRequest,
    estimated_gap_history_hours: projectedPages === null ? null : Math.max(projectedPages * secondsPerRequest / 3600,
      projectedPages * (pointsPerRequest ?? 1) / (api.rate?.limit ?? 5000)),
    estimate_limitation: "Conditional bandwise page/stock ratio; unsampled bands use lifetime ceiling; no calibrated confidence interval. An inaccessible pilot has no gap estimate.",
    strata,
    conditional_lifetime_page_ceiling: worstPages,
    conditional_lifetime_points: pointsPerRequest === null ? null : worstPages * pointsPerRequest,
    conditional_lifetime_serial_hours: worstPages * secondsPerRequest / 3600,
    conditional_lifetime_quota_hours: pointsPerRequest === null ? null : worstPages * pointsPerRequest / (api.rate?.limit ?? 5000),
    current_access_sweep_requests: publicRepos.length,
    current_access_sweep_serial_hours: publicRepos.length * secondsPerRequest / 3600,
    shared_hourly_limit: api.rate?.limit ?? null, rate_reset_at: api.rate?.resetAt ?? null,
  };
}

export async function runFetch({ out, members, client, maxRepos = Infinity, retryUnavailable = false }) {
  let processed = 0;
  let paused = null;
  for (const member of members) {
    const file = join(out, "repos", `${member.id}.json`);
    const status = existsSync(file) ? read(file).status : "pending";
    if (status === "complete" || (status !== "fetching" && status !== "pending" && !retryUnavailable)) continue;
    if (processed >= maxRepos) { paused = "Repository chunk limit reached"; break; }
    try { await fetchRepository({ out, member, client, retryUnavailable }); }
    catch (error) { if (error instanceof Pause) { paused = error.message; break; } throw error; }
    processed++;
  }
  return { ...summarize(out, members), processed_this_chunk: processed, paused };
}

function assertOutput(out) {
  mkdirSync(OUTPUT_ROOT, { recursive: true });
  if (resolve(out) !== OUTPUT_ROOT || realpathSync(out) !== OUTPUT_ROOT) throw new Error(`Collection output must be ${OUTPUT_ROOT}`);
}

async function prepare(out, flags) {
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const whitelist = resolve(flags.whitelist);
  const db = await DuckDBInstance.create();
  const connection = await db.connect();
  let rows;
  try {
    const reader = await connection.runAndReadAll(`SELECT repo_id::VARCHAR AS repo_id FROM read_parquet('${whitelist.replaceAll("'", "''")}')`);
    rows = reader.getRowObjects();
  } finally { connection.closeSync(); db.closeSync(); }
  const retained = read(flags["retained-whitelist"]).map((row) => Number(row.repo_id)).sort((a, b) => a - b);
  if (JSON.stringify(retained) !== JSON.stringify(rows.map((row) => Number(row.repo_id)).sort((a, b) => a - b))) {
    throw new Error("R2 whitelist differs from retained GSC_0045 whitelist");
  }
  const members = fixedMembers(rows, read(flags.metadata), read(flags.sample), read(flags.reference).rows);
  const manifest = { version: VERSION, metric: METRIC, start: START, end_exclusive: END, members,
    sources: Object.fromEntries(["whitelist", "retained-whitelist", "metadata", "sample", "reference"].map((key) => [key, {
      path: resolve(flags[key]), sha256: sha(readFileSync(flags[key])),
    }])), whitelist_origin: "R2 gitstarclub-raw/bigquery-export/whitelist/data-000000000000.parquet; read-only cf CLI; exact retained id-set equality",
  };
  const file = join(out, "manifest.json");
  if (existsSync(file) && JSON.stringify(read(file)) !== JSON.stringify(manifest)) throw new Error("Existing collection has different inputs");
  atomicJson(file, manifest);
  return { repositories: members.length, pilot: members.filter((member) => member.pilot).length, sources: manifest.sources };
}

export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (!command || command === "--help") {
    console.log("star-history.mjs prepare|inventory|fetch|report [--out FIXED_DIRECTORY] [--pilot] [--max-repos N] [--max-seconds N] [--retry-unavailable]\nprepare requires --whitelist FILE --retained-whitelist FILE --metadata FILE --sample FILE --reference FILE\nRead-only gh api graphql only. Data is local, surviving-star lower bounds, never gross/net history.");
    return 0;
  }
  if (!["prepare", "inventory", "fetch", "report"].includes(command)) throw new Error("Unknown command");
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i].replace(/^--/, "");
    if (!rest[i].startsWith("--") || !["out", "whitelist", "retained-whitelist", "metadata", "sample", "reference", "pilot", "max-repos", "max-seconds", "retry-unavailable"].includes(key) || key in flags) throw new Error("Invalid or repeated option");
    flags[key] = ["pilot", "retry-unavailable"].includes(key) ? true : rest[++i];
    if (flags[key] === undefined) throw new Error("Missing option value");
  }
  for (const key of ["max-repos", "max-seconds"]) if (key in flags && (!Number.isSafeInteger(Number(flags[key])) || Number(flags[key]) <= 0)) throw new Error(`Invalid ${key}`);
  const out = flags.out ?? OUTPUT_ROOT;
  assertOutput(out);
  const lock = join(out, ".collector-lock");
  if (existsSync(lock)) {
    const pid = read(join(lock, "owner.json")).pid;
    if (!positiveId(pid)) throw new Error("Invalid collector lock; inspect before recovery");
    try { process.kill(pid, 0); throw new Error("Another collector is running"); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; }
    rmSync(lock, { recursive: true });
  }
  mkdirSync(lock);
  atomicJson(join(lock, "owner.json"), { pid: process.pid });
  try {
    if (command === "prepare") {
      for (const key of ["whitelist", "retained-whitelist", "metadata", "sample", "reference"]) if (!flags[key]) throw new Error(`Missing --${key}`);
      console.log(JSON.stringify(await prepare(out, flags), null, 2));
      return 0;
    }
    const manifest = read(join(out, "manifest.json"));
    if (manifest.version !== VERSION || manifest.start !== START || manifest.end_exclusive !== END || manifest.members.length !== 5249) throw new Error("Manifest contract mismatch");
    const members = flags.pilot ? manifest.members.filter((member) => member.pilot) : manifest.members;
    const client = new GraphqlClient({ out, deadline: Date.now() + Number(flags["max-seconds"] ?? 600) * 1000 });
    if (command === "inventory") {
      try { await inventory({ out, members: manifest.members, client }); }
      catch (error) { if (!(error instanceof Pause)) throw error; console.log(error.message); return 2; }
    }
    if (command === "fetch") {
      const baseline = { ...client.state };
      const started = Date.now();
      const result = await runFetch({ out, members, client, maxRepos: Number(flags["max-repos"] ?? Infinity), retryUnavailable: Boolean(flags["retry-unavailable"]) });
      if (flags.pilot && !existsSync(join(out, "pilot-api.json"))) {
        atomicJson(join(out, "pilot-api.json"), { ...client.state, wall_ms: Date.now() - started,
          ...Object.fromEntries(["requests", "points", "unmetered", "api_ms", "wait_ms"].map((key) => [key, client.state[key] - baseline[key]])) });
      }
      atomicJson(join(out, flags.pilot ? "pilot-summary.json" : "full-summary.json"), result);
      console.log(JSON.stringify({ ...result, measurements: undefined, comparison: { ...result.comparison, rows: undefined } }, null, 2));
      return result.complete ? 0 : 2;
    }
    const report = summarize(out, manifest.members);
    const pilot = summarize(out, manifest.members.filter((member) => member.pilot));
    const projection = estimate({ members: manifest.members, inventories: existsSync(join(out, "inventory.json")) ? read(join(out, "inventory.json")) : {}, pilot,
      api: existsSync(join(out, "pilot-api.json")) ? read(join(out, "pilot-api.json")) : client.state });
    atomicJson(join(out, "full-summary.json"), report);
    atomicJson(join(out, "pilot-summary.json"), pilot);
    atomicJson(join(out, "estimate.json"), projection);
    console.log(JSON.stringify({ summary: { ...report, comparison: undefined, measurements: undefined }, estimate: projection }, null, 2));
    return 0;
  } finally { rmSync(lock, { recursive: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
