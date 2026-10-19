// @ts-nocheck -- Fixtures intentionally include malformed endpoint responses.
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicJson, Pause } from "../scripts/star-history.mjs";
import { AggregateClient, consumePage, END_DAY, exportInputs, fixedMembers, GAP_DAYS, gapSeries, historyEndpoint,
  isoWeek, loadCheckpoint, main, newCheckpoint, PROVENANCE, retryDelay, runFetch, sha256, START_DAY, summarize } from "../scripts/star-history-aggregate.mjs";

const directories = [];
afterEach(() => { for (const out of directories.splice(0)) rmSync(out, { recursive: true, force: true }); });
function fixture() {
  const out = mkdtempSync(join(tmpdir(), "aggregate-"));
  directories.push(out);
  return out;
}
const member = { id: 33, name: "current/name", original_name: "old/name" };
const week = (day, days = [1, 2, 3, 4, 5, 6, 7]) => ({ week: Date.parse(`${day}T00:00:00Z`) / 1000, total: days.reduce((a, b) => a + b, 0), days });
const page = (weeks, headers = {}) => ({ status: 200, body: weeks, headers, evidence: "page.json" });
function fullPage() {
  const oldest = Date.parse("2026-05-24T00:00:00Z");
  return page(Array.from({ length: 20 }, (_, index) => week(new Date(oldest + (19 - index) * 7 * 86400000).toISOString().slice(0, 10))));
}
function complete() { return consumePage(newCheckpoint(member), fullPage()); }
const read = (file) => JSON.parse(readFileSync(file, "utf8"));

test("fixed whitelist rejects expansion, duplicates and missing names; stable-id inventory follows renames", () => {
  const whitelist = [{ repo_id: 33 }];
  const metadata = { 33: { full_name: "old/name" }, 34: { full_name: "extra/name" } };
  const inventory = { 33: { name: "current/name", status: "public", fetched_at: "2026-10-19T00:00:00Z" } };
  expect(fixedMembers(whitelist, metadata, inventory, 1)).toEqual([{ ...member, inventory_status: "public", identity_checked_at: "2026-10-19T00:00:00Z", identity_source: "GSC_0080 stable-id GraphQL inventory" }]);
  expect(() => fixedMembers([...whitelist, ...whitelist], metadata, inventory, 2)).toThrow("whitelist");
  expect(() => fixedMembers([{ repo_id: -1 }], metadata, inventory, 1)).toThrow("whitelist");
  expect(() => fixedMembers(whitelist, metadata, {}, 1)).toThrow("inventory");
  expect(() => fixedMembers(whitelist, metadata, inventory)).toThrow("whitelist");
  expect(historyEndpoint("current/name", 1)).toBe("repos/current/name/stargazers/history?per_page=30&page=1");
  for (const [name, n] of [["https://example.com", 1], ["a/b", 0], ["a/b", 101], ["a/../../b", 1]]) expect(() => historyEndpoint(name, n)).toThrow();
});

test("Sunday calendar arrays are expanded without a shift and clipped to exactly the approved 124 labels", () => {
  const result = complete();
  expect(result.status).toBe("complete");
  expect(Object.keys(result.daily)).toEqual(GAP_DAYS);
  expect(Object.keys(result.daily)[0]).toBe(START_DAY);
  expect(Object.keys(result.daily).at(-1)).toBe(END_DAY);
  expect(result.daily["2026-05-30"]).toBe(7); // Saturday, days[6].
  expect(result.daily["2026-05-31"]).toBe(1); // Sunday, days[0].
  expect(result.daily["2026-06-01"]).toBe(2);
  expect(result.daily["2026-09-30"]).toBe(4);
  expect(result.daily["2026-10-01"]).toBeUndefined();
  expect(result.provenance).toEqual(PROVENANCE);
});

test("zero-star weeks are observations; absent, forbidden and truncated histories are never invented zeros", () => {
  const zero = fullPage();
  zero.body = zero.body.map((row) => ({ ...row, total: 0, days: Array(7).fill(0) }));
  expect(consumePage(newCheckpoint(member), zero)).toMatchObject({ status: "complete", total: 0 });
  for (const [status, expected] of [[404, "not_found_or_inaccessible"], [403, "http_403"], [451, "http_451"]]) {
    expect(consumePage(newCheckpoint(member), { status, evidence: "page.json" })).toMatchObject({ status: expected, daily: null });
  }
  expect(consumePage(newCheckpoint(member), page([]))).toMatchObject({ status: "unavailable_empty_history", daily: null });
  expect(consumePage(newCheckpoint(member), page([week("2026-09-27")]))).toMatchObject({ status: "incomplete_history", daily: null });
  expect(consumePage(newCheckpoint(member), page([week("2026-05-24")]))).toMatchObject({ status: "incomplete_history", daily: null });
});

test("malformed counts, wrong weekdays, missing weeks, duplicates and wrong page order fail closed", () => {
  const good = week("2026-09-27");
  for (const body of [null, {}, [{ ...good, total: 0 }], [{ ...good, days: [1] }], [{ ...good, days: [-1, 2, 3, 4, 5, 6, 8] }],
    [{ ...good, week: good.week + 86400 }], [{ ...good, week: good.week + 1 }], [good, good], [good, week("2026-09-13")],
    [week("2026-09-20"), good], Array(31).fill(good)]) {
    expect(() => consumePage(newCheckpoint(member), page(body))).toThrow();
  }
  expect(() => consumePage(newCheckpoint(member), page([good], { link: '<https://api.github.com/repositories/99/stargazers/history?page=2>; rel="next"' }))).toThrow("identity");
  expect(consumePage(newCheckpoint(member), { ...fullPage(), headers: { link: '<https://api.github.com/repositories/33/stargazers/history?page=2>; rel="next"' } }).response_identity).toBe("stable_id_from_pagination_link");
});

test("paginated repositories checkpoint each page and resume without double counting; complete repos make no extra GET", async () => {
  const out = fixture();
  const full = fullPage().body;
  let requests = 0;
  const client = { now: Date.now, log() {}, request: async (_member, n) => {
    requests++;
    if (n === 1) return page(full.slice(0, 10), { link: '<anything>; rel="next"' });
    throw new Pause("interrupted");
  } };
  const partial = await runFetch({ out, members: [member], client });
  expect(partial.fetch_finished).toBe(false);
  expect(loadCheckpoint(out, member)).toMatchObject({ next_page: 2, status: "fetching" });
  const nextClient = { now: Date.now, log() {}, request: async (_member, n) => { expect(n).toBe(2); return page(full.slice(10)); } };
  expect((await runFetch({ out, members: [member], client: nextClient })).coverage_complete).toBe(true);
  expect(loadCheckpoint(out, member).daily).toEqual(complete().daily);
  await runFetch({ out, members: [member], client: { ...client, request: () => { throw new Error("extra request"); } } });
  expect(requests).toBe(2);
});

test("request spacing, remaining/reset and raw safe headers survive client reconstruction", async () => {
  const out = fixture();
  let time = 100_000;
  const starts = [];
  const transport = async () => {
    starts.push(time);
    time += 10;
    return page([], { "x-ratelimit-remaining": "10", "x-ratelimit-reset": "105", authorization: "do-not-store" });
  };
  const options = { out, transport, now: () => time, wait: async (ms) => { time += ms; }, log() {} };
  await new AggregateClient(options).request(member, 1);
  await new AggregateClient(options).request(member, 2);
  expect(starts).toEqual([100_000, 106_000]);
  const evidence = readdirSync(join(out, "pages/33")).map((path) => readFileSync(join(out, "pages/33", path), "utf8")).join("");
  expect(evidence).not.toContain("do-not-store");
  expect(evidence).not.toContain("authorization");
  expect(read(join(out, "api-state.json")).requests).toBe(2);
});

test("serial starts stay at least 1050 ms apart, including resume after a successful response", async () => {
  const out = fixture();
  let time = 100_000;
  const starts = [];
  const options = { out, now: () => time, wait: async (ms) => { time += ms; }, log() {}, transport: async () => {
    starts.push(time); time += 300; return page([]);
  } };
  await new AggregateClient(options).request(member, 1);
  await new AggregateClient(options).request(member, 2);
  expect(starts[1] - starts[0]).toBe(1050);
});

test("primary/secondary Retry-After and transient failures back off, preserving cooldown across chunk deadlines", async () => {
  expect(retryDelay({ status: 429, headers: { "retry-after": "90" } }, 0, 100_000)).toBe(90_000);
  expect(retryDelay({ status: 403, headers: { "retry-after": "Thu, 01 Jan 1970 00:04:00 GMT" } }, 0, 100_000)).toBe(140_000);
  expect(retryDelay({ status: 403, headers: {}, body: { message: "secondary rate limit" } }, 1, 0)).toBe(120_000);
  expect(retryDelay({ status: 503, headers: {} }, 2, 0)).toBe(4000);
  expect(retryDelay({ status: 200, headers: { "x-ratelimit-remaining": "0" } }, 0, 0)).toBeNull();
  const out = fixture();
  let time = 100_000;
  let calls = 0;
  const client = new AggregateClient({ out, now: () => time, wait: async (ms) => { time += ms; }, deadline: 110_000, log() {},
    transport: async () => { calls++; return { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "200" } }; } });
  await expect(client.request(member, 1)).rejects.toBeInstanceOf(Pause);
  expect(calls).toBe(1);
  expect(read(join(out, "api-state.json")).not_before).toBe(201_000);
  const resumed = new AggregateClient({ out, now: () => time, deadline: 150_000, log() {}, transport: () => { throw new Error("must wait"); } });
  await expect(resumed.request(member, 1)).rejects.toBeInstanceOf(Pause);
});

test("repeated errors are bounded and login failures do not retain CLI diagnostics", async () => {
  const out = fixture();
  let time = 100_000;
  let calls = 0;
  const options = { out, now: () => time, wait: async (ms) => { time += ms; }, log() {}, transport: async () => {
    calls++; return { status: 503, headers: {}, body: { message: "private diagnostics" } };
  } };
  await expect(new AggregateClient(options).request(member, 1)).rejects.toThrow("retry budget");
  expect(calls).toBe(6);
  await expect(new AggregateClient(options).request(member, 1)).rejects.toThrow("retry budget");
  expect(calls).toBe(6);
  const raw = readdirSync(join(out, "pages/33")).map((path) => readFileSync(join(out, "pages/33", path), "utf8")).join("");
  expect(raw).not.toContain("private diagnostics");
  await expect(new AggregateClient({ out: fixture(), transport: async () => ({ status: 401, headers: {}, body: null }) }).request(member, 1)).rejects.toThrow("unauthorized");
});

test("ISO weeks use Monday-Sunday daily sums, exclude both partial edge weeks and handle ISO years", () => {
  const series = gapSeries(complete());
  expect(series.weekly).toHaveLength(17);
  expect(series.weekly[0]).toEqual(["2026-W23", 28]);
  expect(series.weekly.at(-1)).toEqual(["2026-W39", 28]);
  expect(series.partialWeeks).toEqual([
    { period: "2026-W22", sum: 8, days: ["2026-05-30", "2026-05-31"] },
    { period: "2026-W40", sum: 9, days: ["2026-09-28", "2026-09-29", "2026-09-30"] },
  ]);
  expect(isoWeek("2021-01-01")).toBe("2020-W53");
  expect(isoWeek("2025-12-29")).toBe("2026-W01");
  // A Monday impulse must join the following Sunday, not GitHub's native Sunday block.
  const record = complete();
  record.daily = Object.fromEntries(GAP_DAYS.map((day) => [day, ["2026-05-31", "2026-06-01"].includes(day) ? 100 : 0]));
  expect(gapSeries(record).weekly[0]).toEqual(["2026-W23", 100]);
});

test("exports fingerprint sparse coverage, preserve shard tuple shape and never emit monthly/stock artifacts", async () => {
  const out = fixture();
  const absent = { id: 34, name: "missing/repo" };
  const client = new AggregateClient({ out, log() {}, transport: async (name) => name === member.name ? fullPage() : { status: 404, headers: {}, body: null },
    wait: async () => {}, now: (() => { let time = 100000; return () => (time += 2000); })() });
  await runFetch({ out, members: [member, absent], client });
  atomicJson(join(out, "manifest.json"), { sources: { fixture: "pinned" } });
  const exported = exportInputs(out, [member, absent]);
  expect(exported).toMatchObject({ fetch_finished: true, coverage_complete: false, daily_rows: 124, complete_week_rows: 17, full_whitelist_surviving_stars: null });
  const manifest = read(join(out, "inputs/manifest.json"));
  expect(manifest.monthly_files).toEqual([]);
  expect(manifest.provenance.monthly_policy).toBe(PROVENANCE.monthly_policy);
  expect(manifest.missing).toEqual([{ repo_id: 34, name: "missing/repo", status: "not_found_or_inaccessible" }]);
  expect(read(join(out, "inputs/canonical/v2/repo-recent-daily/1.json"))[33][0]).toEqual(["2026-05-30", 7]);
  expect(read(join(out, "inputs/canonical/v2/repo-recent-daily/2.json"))).toEqual({});
  expect(existsSync(join(out, "inputs/canonical/v2/repo-monthly"))).toBe(false);
  for (const file of manifest.files) expect(sha256(readFileSync(join(out, "inputs", file.path)))).toBe(file.sha256);
  expect(manifest.raw_responses).toHaveLength(2);
  for (const file of manifest.raw_responses) expect(sha256(readFileSync(join(out, file.path)))).toBe(file.sha256);
  for (const checkpoint of manifest.checkpoints) {
    expect(checkpoint.raw_replay_verified).toBe(true);
    expect(sha256(readFileSync(join(out, checkpoint.path)))).toBe(checkpoint.sha256);
    for (const page of checkpoint.pages) expect(sha256(readFileSync(join(out, page.path)))).toBe(page.sha256);
  }
  expect(exportInputs(out, [member, absent]).manifest_sha256).toBe(exported.manifest_sha256);
  const changed = loadCheckpoint(out, member);
  changed.daily[START_DAY]++;
  changed.total++;
  atomicJson(join(out, "repos/33.json"), changed);
  expect(() => exportInputs(out, [member, absent])).toThrow("Raw evidence");
});

test("pending sweep cannot export; checkpoint identity/metric changes and invalid CLI scope are rejected", async () => {
  const out = fixture();
  expect(() => exportInputs(out, [member])).toThrow("Finish");
  atomicJson(join(out, "repos/33.json"), { ...complete(), repo_id: 99 });
  expect(() => summarize(out, [member])).toThrow("contract");
  atomicJson(join(out, "repos/33.json"), { ...complete(), daily: {} });
  expect(() => loadCheckpoint(out, member)).toThrow("daily");
  for (const args of [["upload"], ["fetch", "--out", "/tmp"], ["fetch", "--max-seconds", "600"], ["fetch", "--max-repos", "0"], ["fetch", "--max-repos"], ["fetch", "--max-repos", "1", "--max-repos", "2"]]) {
    await expect(main(args)).rejects.toThrow();
  }
});
