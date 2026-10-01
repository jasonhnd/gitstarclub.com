import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  githubLogin, githubRepoName, githubRepoFullName, isGithubRepoId,
  rankingYear, rankingRoutePeriod, isRankingPeriod,
} from "./public-params";

const now = new Date("2026-10-01T00:00:00Z");
const invalidSegments = ["", "%", "%2F", "%252F", "%76ercel", "%ZZ", "%E0%A4%A", "/", "\\", "..", "a/b", "a?b", "a#b", "a b", "a\0b", "a\nb", "a\r", "a\n", "é", "\ud800"];

describe("decoded GitHub parameters", () => {
  test("preserves case and valid boundary lengths", () => {
    for (const login of ["A", "0", "Git-Hub", "a".repeat(39)]) expect(githubLogin(login)).toBe(login);
    for (const name of ["next.js", ".github", "-", "_", "a..b", "a".repeat(100)]) expect(githubRepoName(name)).toBe(name);
    expect(githubRepoFullName("Vercel", "Next.js")).toBe("Vercel/Next.js");
  });

  test.each([...invalidSegments, "a".repeat(40), "-a", "a-", "a--b", "a_b", "a.b"])("rejects invalid login %j without decoding", (value) => {
    expect(githubLogin(value)).toBeNull();
    expect(githubRepoFullName(value, "repo")).toBeNull();
  });

  test.each([...invalidSegments, ".", "a".repeat(101)])("rejects invalid repository name %j", (value) => {
    expect(githubRepoName(value)).toBeNull();
    expect(githubRepoFullName("owner", value)).toBeNull();
  });

  test("bounds repository IDs without rounding or string coercion", () => {
    expect(isGithubRepoId(1)).toBe(true);
    expect(isGithubRepoId(Number.MAX_SAFE_INTEGER)).toBe(true);
    for (const id of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(isGithubRepoId(id)).toBe(false);
  });
});

describe("ranking parameters", () => {
  test("requires bounded four-digit years", () => {
    expect(rankingYear("2015", now)).toBe(2015);
    expect(rankingYear("2027", now)).toBe(2027);
    for (const year of ["2014", "2028", "9999", "02024", "24", "2e3", "2024.0", "+2024", " 2024", "%32%30%32%34", "2024\n"]) {
      expect(rankingYear(year, now)).toBeNull();
    }
  });

  test("normalizes only valid numeric month and real ISO week routes", () => {
    expect(rankingRoutePeriod("2024", undefined, now)).toEqual({ window: "year", year: 2024, period: "2024" });
    for (const value of ["6", "06"]) expect(rankingRoutePeriod("2024", value, now)).toEqual({ window: "month", year: 2024, month: 6, period: "2024-06" });
    for (const value of ["W1", "w01"]) expect(rankingRoutePeriod("2024", value, now)).toEqual({ window: "week", year: 2024, week: 1, period: "2024-W01" });
    expect(rankingRoutePeriod("2020", "W53", now)).toMatchObject({ period: "2020-W53" });
    expect(rankingRoutePeriod("2021", "W53", now)).toBeNull();
  });

  test.each(["", "%", "%31", "../", "0", "13", "99", "001", "1e1", "1.0", "+1", " 1", "1\n", "W0", "W54", "W001", "W1\n", "Infinity"])("rejects invalid route period %j", (value) => {
    expect(rankingRoutePeriod("2024", value, now)).toBeNull();
  });

  test("storage identifiers must match their window and canonical spelling", () => {
    for (const [window, period] of [["year", "2024"], ["month", "2024-06"], ["week", "2020-W53"], ["all", "all"]]) expect(isRankingPeriod(window, period)).toBe(true);
    for (const [window, period] of [["year", "../2024"], ["month", "2024-6"], ["month", "2024-06\n"], ["week", "2021-W53"], ["week", "2024-w01"], ["week", "2024-W1"], ["all", "../all"], ["bogus", "2024"], ["month", "2024-06/../../lookup"]]) expect(isRankingPeriod(window, period)).toBe(false);
  });
});

// Bun module mocks are process-global. Run the actual boundary handlers in child
// processes, with fabricated data and no fetch, rather than mocking the suite.
async function probe(code: string) {
  const child = Bun.spawn([process.execPath, "--eval", code], {
    cwd: resolve(import.meta.dir, ".."),
    env: { PATH: process.env.PATH, HOME: process.env.HOME, BLOB_BASE_URL: "https://blob.example.com", SEO_LIVE_BASE: "" },
    stdout: "pipe", stderr: "pipe",
  });
  const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect({ exit, out, err }).toEqual({ exit: 0, out: "", err: "" });
}

const noNetwork = `const originalFetch = globalThis.fetch; process.on("exit", () => { globalThis.fetch = originalFetch; }); globalThis.fetch = () => { throw new Error("Unexpected network request"); };`;

describe("actual public boundaries", () => {
  test("all parameterized image routes reject input before reads and retain valid cards", async () => {
    await probe(`
      import { mock } from "bun:test";
      import assert from "node:assert/strict";
      ${noNetwork}
      const reads = [];
      let available = true;
      const repo = { full_name: "Vercel/Next.js", current_stars: 10, language: null };
      mock.module("@/lib/data", () => ({
        getRepoIdByFullNameDaily: async () => { reads.push("ids"); return new Map([["vercel/next.js", 1]]); },
        getRepoPageEntityDaily: async (id) => { reads.push(id); return repo; },
        getRankDaily: async (...args) => { reads.push(args); return available ? {items: []} : null; },
        getReposLookupDaily: async () => { reads.push("lookup"); return available ? {} : null; },
        joinRepoRank: () => [{owner:"vercel", name:"next.js", value:3}, {owner:"unsafe/owner", name:"repo", value:2}],
      }));
      mock.module("@/lib/og-card", () => ({
        OG_SIZE: {width:1200,height:630}, siteCard: () => ({kind:"generic"}),
        repoCard: (card) => card, rankingCard: (label, rows) => ({label, rows}),
      }));
      const repoImage = (await import("./app/(en)/[locale]/[owner]/opengraph-image")).default;
      const yearImage = (await import("./app/(en)/rankings/[year]/opengraph-image")).default;
      const periodImage = (await import("./app/(en)/rankings/[year]/[period]/opengraph-image")).default;
      for (const value of ${JSON.stringify(invalidSegments)}) {
        assert.deepEqual(await repoImage({params:Promise.resolve({locale:value,owner:"repo"})}), {kind:"generic"});
        assert.deepEqual(await repoImage({params:Promise.resolve({locale:"owner",owner:value})}), {kind:"generic"});
        assert.deepEqual(await yearImage({params:Promise.resolve({year:value})}), {kind:"generic"});
      }
      for (const period of ["%", "99", "W54", "W53", "1e1", "../", "001"]) {
        assert.deepEqual(await periodImage({params:Promise.resolve({year:"2021",period})}), {kind:"generic"});
      }
      assert.deepEqual(reads, []);
      const {getRouteMatcher} = await import("next/dist/shared/lib/router/utils/route-matcher.js");
      const {getRouteRegex} = await import("next/dist/shared/lib/router/utils/route-regex.js");
      const match = getRouteMatcher(getRouteRegex("/[locale]/[owner]"));
      assert.equal((await repoImage({params:Promise.resolve(match("/%56ercel/Next%2Ejs"))})).fullName, repo.full_name);
      reads.length = 0;
      for (const path of ["/%25/repo", "/%2556ercel/Next.js", "/owner/a%2Fb"]) {
        assert.deepEqual(await repoImage({params:Promise.resolve(match(path))}), {kind:"generic"});
      }
      assert.deepEqual(reads, []);
      assert.deepEqual(await yearImage({params:Promise.resolve({year:"2024"})}), {label:"2024",rows:[{full:"vercel/next.js",gained:3}]});
      assert.deepEqual(reads[0], ["year","2024","repo","flow"]);
      reads.length = 0;
      assert.equal((await periodImage({params:Promise.resolve({year:"2024",period:"06"})})).label, "June 2024");
      assert.deepEqual(reads[0], ["month","2024-06","repo","flow"]);
      reads.length = 0;
      assert.equal((await periodImage({params:Promise.resolve({year:"2020",period:"w53"})})).label, "2020 · Week 53");
      assert.deepEqual(reads[0], ["week","2020-W53","repo","flow"]);
      available = false;
      assert.deepEqual(await yearImage({params:Promise.resolve({year:"2024"})}), {kind:"generic"});
      assert.deepEqual(await periodImage({params:Promise.resolve({year:"2024",period:"6"})}), {kind:"generic"});
    `);
  });

  test("repo/org/ranking pages and metadata produce controlled 404s for malformed params", async () => {
    await probe(`
      import { mock } from "bun:test";
      import assert from "node:assert/strict";
      ${noNetwork}
      const data = await import("@/lib/data");
      const reads = [];
      mock.module("@/lib/data", () => ({...data,
        getRepoIdByFullNameDaily: async () => {reads.push("ids");return new Map([["vercel/next.js",1]]);},
        getRepoPageEntityDaily: async () => {reads.push("repo");return {full_name:"Vercel/Next.js",current_stars:10};},
        getOrgEntityDaily: async (login) => {reads.push(login);return null;},
      }));
      const repo = await import("./app/_localized/repo");
      const org = await import("./app/_localized/org");
      const rank = await import("./app/_localized/ranking-detail");
      const is404 = (error) => error.digest === "NEXT_HTTP_ERROR_FALLBACK;404";
      for (const locale of ["en","ja","zh"]) {
        for (const value of ${JSON.stringify(invalidSegments)}) {
          for (const args of [{locale,owner:value,name:"repo"},{locale,owner:"owner",name:value}]) {
            await assert.rejects(() => repo.generateRepoMetadata(args), is404);
            await assert.rejects(() => repo.RepoPageView(args), is404);
          }
          await assert.rejects(() => org.generateOrgMetadata({locale,login:value}), is404);
          await assert.rejects(() => org.OrgPageView({locale,login:value}), is404);
        }
        await assert.rejects(() => rank.generateRankingYearMetadata(locale,"2e3"), is404);
        await assert.rejects(() => rank.RankingsYearPageView({locale,year:"%"}), is404);
        await assert.rejects(() => rank.generateRankingPeriodMetadata(locale,{year:"2021",period:"W53"}), is404);
        await assert.rejects(() => rank.RankingsPeriodPageView({locale,year:"2024",period:"1e1"}), is404);
      }
      assert.deepEqual(reads, []);
      const metadata = await repo.generateRepoMetadata({locale:"en",owner:"VERCEL",name:"NEXT.js"});
      assert.ok(metadata.title.startsWith("Vercel/Next.js — "));
      await org.generateOrgMetadata({locale:"en",login:"Git-Hub"});
      assert.deepEqual(reads, ["ids","repo","Git-Hub"]);
    `);
  });

  test("entity, rank, and heatmap readers independently block invalid storage fragments", async () => {
    await probe(`
      import { mock } from "bun:test";
      import assert from "node:assert/strict";
      ${noNetwork}
      const source = await import("./lib/data/source");
      const reads = [];
      const read = async (path) => {reads.push(path);return null;};
      mock.module("@/lib/data/source", () => ({...source,readView:read,readAuthoritativeView:read}));
      mock.module("@/lib/data/watermark", () => ({isLiveOverlayPeriod:async () => {reads.push("watermark");return false;}}));
      const entity = await import("./lib/data/entity");
      const rank = await import("./lib/data/rank");
      const heat = await import("./lib/data/heatmap");
      for (const login of ${JSON.stringify(invalidSegments)}) {
        assert.equal(await entity.getOrgEntity(login), null);
        assert.equal(await entity.getOrgEntityDaily(login), null);
      }
      for (const id of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) {
        for (const read of [entity.getRepoEntity,entity.getRepoEntityDaily,entity.getRepoPageEntityDaily]) assert.equal(await read(id),null);
      }
      for (const [window,period] of [["year","%"],["year","9999"],["month","../lookup"],["month","2024-6"],["week","2021-W53"],["week","2024-W01/../../lookup"],["all","../all"],["year/..","2024"]]) {
        for (const read of [rank.getRankBase,rank.getRankBaseDaily,rank.getRank,rank.getRankDaily]) assert.equal(await read(window,period,"repo","flow"),null);
        assert.throws(() => rank.getRankBaseAuthoritative(window,period,"repo","flow"), /Invalid ranking/);
      }
      for (const [dim,metric] of [["repo/..","flow"],["repo","flow/.."]]) assert.equal(await rank.getRankDaily("month","2024-06",dim,metric),null);
      assert.equal(await rank.getAllTime("repo/.."),null);
      for (const [scope,period] of [["year","%"],["month","2024-99"],["month","../lookup"],["week","2024-W01"],["all","all"]]) {
        assert.equal(await heat.getHeatmap(scope,period),null);
        assert.equal(await heat.getHeatmapBase(scope,period),null);
        assert.throws(() => heat.getHeatmapBaseAuthoritative(scope,period), /Invalid heatmap/);
      }
      assert.deepEqual(reads, []);
      await entity.getOrgEntity("Git-Hub");
      await entity.getRepoPageEntityDaily(1);
      await rank.getRankBase("year","2024","repo","flow");
      await rank.getRankBaseDaily("week","2020-W53","repo","flow");
      await rank.getRankBaseAuthoritative("month","2024-06","org","stock");
      await heat.getHeatmapBaseAuthoritative("year","2024");
      assert.deepEqual(reads, ["entity/org/Git-Hub.json","entity/repo/1.json","rank/year/2024/repo/flow.json","rank/week/2020-W53/repo/flow.json","rank/month/2024-06/org/stock.json","heatmap/year/2024.json"]);
      reads.length = 0;
      await rank.getRankDaily("month","2024-06","repo","flow");
      assert.deepEqual(reads, ["watermark","rank/month/2024-06/repo/flow.json","rank/month/2024-06/repo/flow.json"]);
    `);
  });
});
