// @ts-nocheck -- Offline fixtures deliberately exercise malformed API responses.
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  atomicJson, consumePage, estimate, fetchInitialBatch, fetchRepository, fixedMembers, ghGraphql, GraphqlClient,
  HISTORY_QUERY, INITIAL_HISTORY_QUERY, inventory, METRIC, newCheckpoint, parseGhResponse, Pause, retryDelay, runFetch, summarize,
} from "../scripts/star-history.mjs";

const directories = [];
afterEach(() => { for (const out of directories.splice(0)) rmSync(out, { recursive: true, force: true }); });
function fixture() {
  const out = mkdtempSync(join(tmpdir(), "star-history-"));
  directories.push(out);
  return out;
}
const member = { id: 1, node_id: "legacy-one", original_name: "old/name", sample: true, reference_history: 10, reference_archive: 1 };
const edge = (cursor, starredAt) => ({ cursor, starredAt });
function node(edges, total = edges.length, more = false, extra = {}) {
  return { id: "stable-one", databaseId: 1, nameWithOwner: "new/name", isPrivate: false, stargazerCount: total,
    stargazers: { totalCount: total, edges, pageInfo: { hasNextPage: more, endCursor: edges.at(-1)?.cursor ?? null } }, ...extra };
}
const rate = { limit: 5000, cost: 1, remaining: 4000, resetAt: "2026-10-20T00:00:00Z" };
const response = (value, extra = {}) => ({ status: 200, headers: { date: "Mon, 19 Oct 2026 12:00:00 GMT" }, body: { data: { node: value, rateLimit: rate } }, ...extra });

test("descending pagination includes exact UTC boundaries and stops before the first approved day", () => {
  const first = consumePage(newCheckpoint(member), node([
    edge("a", "2026-10-01T00:00:00Z"),
    edge("b", "2026-09-30T23:59:59Z"),
    edge("c", "2026-05-30T09:00:00+09:00"),
  ], 6, true), member);
  expect(first.status).toBe("fetching");
  expect(first.cursor).toBe("c");
  const second = consumePage(first, node([
    edge("d", "2026-05-30T00:00:00Z"),
    edge("e", "2026-05-30T00:59:59+01:00"),
  ], 6, true), member);
  expect(second).toMatchObject({ status: "complete", stop_reason: "before_start", repo_id: 1, renamed: true, total: 3 });
  expect(second.daily["2026-05-30"]).toBe(2);
  expect(second.daily["2026-09-30"]).toBe(1);
  expect(Object.keys(second.daily)).toHaveLength(124);
  expect(second.daily["2026-10-01"]).toBeUndefined();
  expect(second.metric).toBe(METRIC);
  expect(first.pages).toBe(1);
});

test("exhaustion verifies total stock, including a genuinely empty repository", () => {
  expect(consumePage(newCheckpoint(member), node([]), member)).toMatchObject({ status: "complete", total: 0, stop_reason: "exhausted" });
  const result = consumePage(newCheckpoint(member), node([edge("a", "2026-07-01T00:00:00Z")]), member);
  expect(result.total).toBe(1);
  expect(result.daily["2026-07-01"]).toBe(1);
});

test("positive stock with empty or mismatched connections is unavailable, never zero history", () => {
  const empty = consumePage(newCheckpoint(member), node([], 457477, false, { stargazers: { totalCount: 0, edges: [], pageInfo: { hasNextPage: false, endCursor: null } } }), member);
  expect(empty).toMatchObject({ status: "unavailable_empty_history", daily: null, stargazer_count: 457477, connection_total: 0 });
  expect(empty.total).toBeUndefined();
  const mismatch = node([edge("a", "2026-07-01T00:00:00Z")], 2);
  mismatch.stargazers.totalCount = 1;
  expect(consumePage(newCheckpoint(member), mismatch, member).status).toBe("unavailable_count_mismatch");
});

test("stable ids preserve renames and reject reassigned names; private and missing repos stay explicit", () => {
  expect(consumePage(newCheckpoint(member), node([]), member).renamed).toBe(true);
  expect(() => consumePage(newCheckpoint(member), node([], 0, false, { databaseId: 2 }), member)).toThrow("identity");
  expect(consumePage(newCheckpoint(member), null, member)).toMatchObject({ status: "not_found_or_inaccessible", daily: null });
  expect(consumePage(newCheckpoint(member), node([], 0, false, { isPrivate: true }), member)).toMatchObject({ status: "private", daily: null });
});

test("malformed, duplicate, out-of-order, truncated and non-advancing pages cannot count as complete", () => {
  const cases = [
    node([edge("a", "invalid")]),
    node([edge("a", "2026-07-01")]),
    node([edge("a", "2026-06-31T00:00:00Z")]),
    node([edge("a", "2026-07-01T00:00:00Z"), edge("a", "2026-06-01T00:00:00Z")]),
    node([edge("a", "2026-06-01T00:00:00Z"), edge("b", "2026-07-01T00:00:00Z")]),
    node([edge("a", "2026-07-01T00:00:00Z")], 2, false),
    node([edge("a", "2026-07-01T00:00:00Z")], 1, true, { stargazers: { totalCount: 1, edges: [edge("a", "2026-07-01T00:00:00Z")], pageInfo: { hasNextPage: true, endCursor: "wrong" } } }),
    node([], 0, true),
  ];
  for (const value of cases) expect(() => consumePage(newCheckpoint(member), value, member)).toThrow();
  const first = consumePage(newCheckpoint(member), node([edge("a", "2026-07-01T00:00:00Z")], 2, true), member);
  expect(() => consumePage(first, node([edge("a", "2026-07-01T00:00:00Z")], 2, true), member)).toThrow("repeated");
  expect(consumePage(first, node([edge("b", "2026-06-01T00:00:00Z")], 3, true), member)).toMatchObject({ status: "source_changed", daily: null });
});

test("an interrupted page resumes from the atomic cursor/count checkpoint without double-counting", async () => {
  const out = fixture();
  let calls = 0;
  const client = { now: Date.now, log() {}, request: async (_query, variables) => {
    expect(variables.after).toBe(calls === 0 ? null : "a");
    if (calls++ === 0) return response(node([edge("a", "2026-07-01T00:00:00Z")], 2, true));
    throw new Pause("test interruption");
  } };
  await expect(fetchRepository({ out, member, client })).rejects.toBeInstanceOf(Pause);
  const partial = JSON.parse(readFileSync(join(out, "repos/1.json"), "utf8"));
  expect(partial).toMatchObject({ cursor: "a", pages: 1, daily: { "2026-07-01": 1 }, status: "fetching" });
  const resumed = { now: Date.now, log() {}, request: async (query, variables) => {
    expect(query).toBe(HISTORY_QUERY);
    expect(variables).toEqual({ id: "stable-one", after: "a" });
    return response(node([edge("b", "2026-06-01T00:00:00Z")], 2));
  } };
  expect(await fetchRepository({ out, member, client: resumed })).toMatchObject({ status: "complete", total: 2, pages: 2 });
  expect(existsSync(join(out, "pages/1", partial.attempt, "0000001.json"))).toBe(true);
  resumed.request = () => { throw new Error("completed repos must not refetch"); };
  expect((await fetchRepository({ out, member, client: resumed })).total).toBe(2);
});

test("unavailable states are checkpointed and retried only on explicit retry; malformed history stays null", async () => {
  const out = fixture();
  let calls = 0;
  const client = { now: Date.now, log() {}, request: async () => { calls++; return response(node([], 100)); } };
  const firstAttempt = await fetchRepository({ out, member, client });
  await fetchRepository({ out, member, client });
  expect(calls).toBe(1);
  const summary = summarize(out, [member]);
  expect(summary).toMatchObject({ complete: false, verified_repositories: 0, verified_repo_days: 0,
    comparison: { matched_graphql_total: null, matched_reference_total: null } });
  client.request = async () => response(node([edge("a", "bad")]));
  const retry = await fetchRepository({ out, member, client, retryUnavailable: true });
  expect(retry).toMatchObject({ status: "invalid_history", daily: null });
  expect(retry.attempt).not.toBe(firstAttempt.attempt);
  expect(existsSync(join(out, "pages/1", firstAttempt.attempt, "0000000.json"))).toBe(true);
  expect(existsSync(join(out, "pages/1", retry.attempt, "0000000.json"))).toBe(true);
});

test("GraphQL partial errors are rejected, while NOT_FOUND and FORBIDDEN are explicit", async () => {
  const out = fixture();
  const client = { now: Date.now, log() {}, request: async () => response(null, { body: { data: { node: null, rateLimit: rate }, errors: [{ type: "NOT_FOUND", path: ["node"] }] } }) };
  expect((await fetchRepository({ out, member, client })).status).toBe("not_found_or_inaccessible");
  client.request = async () => response(null, { body: { data: { node: null, rateLimit: rate }, errors: [{ type: "FORBIDDEN", path: ["node", "stargazers"] }] } });
  expect((await fetchRepository({ out, member, client, retryUnavailable: true })).status).toBe("forbidden");
  client.request = async () => response(node([]), { body: { data: { node: node([]), rateLimit: rate }, errors: [{ type: "INTERNAL", path: ["node"] }] } });
  await expect(fetchRepository({ out, member, client, retryUnavailable: true })).rejects.toThrow("partial GraphQL");
});

test("inventory resolves stable ids, keeps null members, rejects truncation and resumes batches", async () => {
  const out = fixture();
  const members = [member, { ...member, id: 2 }];
  const client = { now: Date.now, log() {}, request: async () => ({ body: { data: { nodes: [node([]), null] }, errors: [{ type: "NOT_FOUND", path: ["nodes", 1] }] } }) };
  expect(await inventory({ out, members, client })).toMatchObject({ "1": { status: "public", name: "new/name" }, "2": { status: "not_found_or_inaccessible" } });
  client.request = () => { throw new Error("no inventory refetch"); };
  expect(Object.keys(await inventory({ out, members, client }))).toHaveLength(2);
  await expect(inventory({ out: fixture(), members, client: { ...client, request: async () => ({ body: { data: { nodes: [] } } }) } })).rejects.toThrow("Truncated inventory");
});

test("the gh parser retains only response headers/body, and arbitrary/mutating queries never execute", async () => {
  const parsed = parseGhResponse('HTTP/2.0 200 OK\r\nX-RateLimit-Remaining: 2\r\nDate: Mon, 19 Oct 2026 12:00:00 GMT\r\n\r\n{"data":{"node":null}}');
  expect(parsed).toMatchObject({ status: 200, headers: { "x-ratelimit-remaining": "2" }, body: { data: { node: null } } });
  expect(parseGhResponse("not HTTP").status).toBe(0);
  await expect(ghGraphql("mutation { anything }", {})).rejects.toThrow("read-only collector queries");
});

test("primary resets and Retry-After are honored without a 60-second cap", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  expect(retryDelay({ status: 200, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(now / 1000 + 3600) }, body: { errors: [{ type: "RATE_LIMITED" }] } }, 0, now)).toBe(3601000);
  expect(retryDelay({ status: 429, headers: { "retry-after": "7200" }, body: {} }, 0, now)).toBe(7200000);
  expect(retryDelay({ status: 403, headers: { "retry-after": "Mon, 19 Oct 2026 13:00:00 GMT" }, body: {} }, 0, now)).toBe(3600000);
  expect(retryDelay({ status: 200, headers: {}, body: { errors: [{ message: "secondary rate limit" }] } }, 2, now)).toBe(240000);
  expect(retryDelay({ status: 401, headers: {}, body: {} }, 0, now)).toBeNull();
});

test("persisted quota cooldown pauses a short chunk and survives a process restart", async () => {
  const out = fixture();
  let now = 1_000_000;
  const options = { out, now: () => now, wait: async (ms) => { now += ms; }, intervalMs: 0, deadline: now + 10000, log() {} };
  const client = new GraphqlClient({ ...options, transport: async () => response(null, { status: 429, headers: { "retry-after": "3600" }, body: {} }) });
  await expect(client.request(HISTORY_QUERY, {})).rejects.toBeInstanceOf(Pause);
  expect(client.state.requests).toBe(1);
  const restarted = new GraphqlClient({ ...options, transport: () => { throw new Error("must not bypass cooldown"); } });
  await expect(restarted.request(HISTORY_QUERY, {})).rejects.toBeInstanceOf(Pause);
  expect(restarted.state.not_before).toBe(now + 3600000);
});

test("secondary backoff is exponential, bounded by attempts, and waits in at most one-minute slices", async () => {
  const out = fixture();
  let now = 1000;
  let calls = 0;
  const waits = [];
  const client = new GraphqlClient({ out, now: () => now, intervalMs: 0, log() {}, wait: async (ms) => { waits.push(ms); now += ms; }, transport: async () => {
    calls++;
    return calls <= 2 ? response(null, { body: { errors: [{ message: "secondary rate limit" }] } }) : response(node([]));
  } });
  await client.request(HISTORY_QUERY, {});
  expect(waits).toEqual([60000, 60000, 60000]);
  expect(client.state).toMatchObject({ requests: 3, points: 1, unmetered: 2, wait_ms: 180000 });
  const failing = new GraphqlClient({ out: fixture(), now: () => now, intervalMs: 0, log() {}, wait: async (ms) => { now += ms; }, transport: async () => ({ status: 503, headers: {}, body: null }) });
  await expect(failing.request(HISTORY_QUERY, {})).rejects.toThrow("retry budget exhausted");
  expect(failing.state.requests).toBe(6);
});

test("full-fetch chunks checkpoint each repo and can continue remaining members", async () => {
  const out = fixture();
  const members = [member, { ...member, id: 2, sample: false }];
  const client = { now: Date.now, log() {}, request: async (query, variables) => {
    expect(query).toBe(INITIAL_HISTORY_QUERY);
    return response(null, { body: { data: { nodes: variables.ids.map((id) => node([], 0, false, { databaseId: id === "two" ? 2 : 1 })), rateLimit: rate } } });
  } };
  members[1].node_id = "two";
  expect(await runFetch({ out, members, client, maxRepos: 1 })).toMatchObject({ verified_repositories: 1, statuses: { complete: 1, pending: 1 } });
  expect(await runFetch({ out, members, client })).toMatchObject({ complete: true, verified_repositories: 2 });
});

test("batched initial pages checkpoint each identity separately, then continue individual cursors", async () => {
  const out = fixture();
  const members = [member, { ...member, id: 2, node_id: "two", sample: false }];
  let calls = 0;
  const client = { now: Date.now, log() {}, request: async (query, variables) => {
    calls++;
    if (query === INITIAL_HISTORY_QUERY) return response(null, { body: { data: { nodes: [
      node([edge("a", "2026-07-01T00:00:00Z")], 2, true),
      node([], 1000, false, { databaseId: 2 }),
    ], rateLimit: rate } } });
    expect(variables).toEqual({ id: "stable-one", after: "a" });
    return response(node([edge("b", "2026-06-01T00:00:00Z")], 2));
  } };
  const summary = await runFetch({ out, members, client });
  expect(calls).toBe(2);
  expect(summary).toMatchObject({ verified_repositories: 1, statuses: { complete: 1, unavailable_empty_history: 1 } });
  await expect(fetchInitialBatch({ out: fixture(), members, client: { ...client, request: async () => response(null, { body: { data: { nodes: [null] } } }) } })).rejects.toThrow("Truncated initial-page");
});

test("retry rounds make progress past unavailable prefixes across bounded chunks", async () => {
  const out = fixture();
  const members = [member, { ...member, id: 2, node_id: "two", sample: false }];
  const requested = [];
  const client = { now: Date.now, log() {}, request: async (_query, variables) => {
    requested.push(variables.ids);
    return response(null, { body: { data: { nodes: variables.ids.map((id) => node([], 100, false, { databaseId: id === "two" ? 2 : 1 })), rateLimit: rate } } });
  } };
  await runFetch({ out, members, client });
  requested.length = 0;
  expect(await runFetch({ out, members, client, retryUnavailable: true, maxRepos: 1 })).toMatchObject({ retry_round_remaining: 1 });
  expect(await runFetch({ out, members, client, retryUnavailable: true, maxRepos: 1 })).toMatchObject({ retry_round_remaining: 0 });
  expect(requested).toEqual([["legacy-one"], ["two"]]);
});

test("pilot membership is fixed at 40 references plus ten deterministic whitelisted extras", () => {
  const ids = Array.from({ length: 60 }, (_, i) => i + 1);
  const rows = ids.map((id) => ({ repo_id: String(id) }));
  const samples = ids.slice(0, 40).map((id) => ({ id }));
  const refs = samples.map(({ id }) => ({ repo_id: id, github_history_proxy: id === 1 ? 342659 : 0, archive_gross: 0 }));
  const members = fixedMembers(rows, {}, samples, refs, 60);
  expect(members.filter((repo) => repo.pilot)).toHaveLength(50);
  expect(members.filter((repo) => repo.sample)).toHaveLength(40);
  expect(fixedMembers(rows.toReversed(), {}, samples.toReversed(), refs, 60)).toEqual(members);
  expect(() => fixedMembers(rows, {}, samples.slice(1), refs, 60)).toThrow("40 original");
  expect(() => fixedMembers([...rows.slice(1), rows[1]], {}, samples, refs, 60)).toThrow("whitelist");
});

test("an inaccessible pilot has no invented counts or gap-hours estimate; lifetime ceiling is conditional", () => {
  const out = fixture();
  atomicJson(join(out, "repos/1.json"), { ...newCheckpoint(member), status: "unavailable_empty_history", daily: null });
  const pilot = summarize(out, [member]);
  const projection = estimate({ members: [member], inventories: { "1": { status: "public", stargazer_count: 40100 } }, pilot,
    api: { requests: 1, points: 1, unmetered: 0, api_ms: 500, wait_ms: 0, rate } });
  expect(projection).toMatchObject({ conditional_lifetime_page_ceiling: 401, measured_points_per_request: 1,
    estimated_gap_history_requests: null, estimated_gap_history_hours: null, verified_pilot_repositories: 0 });
  expect(pilot.comparison.rows[0]).toMatchObject({ graphql_total: null, reference_history: 10 });
});
