import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

// Bun module substitutions cannot be restored in the parent process. Each probe
// runs in a disposable child so the full suite retains the real source/watermark.
function runIsolatedProbe(script: string): void {
  const result = Bun.spawnSync([process.execPath, "--eval", script], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    env: { ...process.env, BLOB_BASE_URL: "https://blob.example.com", SEO_LIVE_BASE: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect({
    exitCode: result.exitCode,
    output: result.stdout.toString() + result.stderr.toString(),
  }).toEqual({ exitCode: 0, output: "" });
}

const rankProbeSetup = `
  import assert from "node:assert/strict";
  import { mock } from "bun:test";
  const ttl = 86_400_000;
  const calls = [];
  let overlay = false;
  let base = null;
  let live = null;
  let failedRead = null;
  mock.module("./lib/data/source.ts", () => ({
    DAILY_BASE_VIEW_TTL_MS: ttl,
    DAILY_BASE_VIEW_OPTS: { base: true, versionTtlMs: ttl },
    readView: async (path, schema, opts) => {
      const kind = opts.live ? "live" : "base";
      calls.push({ kind, path, opts });
      if (kind === failedRead) throw new Error("read failed");
      return opts.live ? live : base;
    },
    readAuthoritativeView: async (path, schema, opts) => {
      calls.push({ kind: "authoritative", path, opts });
      if (failedRead) throw new Error("authoritative failed");
      return base;
    },
  }));
  mock.module("./lib/data/watermark.ts", () => ({
    isLiveOverlayPeriod: async (window, period, versionTtlMs) => {
      calls.push({ kind: "watermark", window, period, versionTtlMs });
      if (failedRead === "watermark") throw new Error("read failed");
      return overlay;
    },
  }));
  const rank = await import("./lib/data/rank.ts");
`;

describe("rank read policy", () => {
  test("normal/daily payloads, lazy read order, paths and pointer TTLs agree across the full policy matrix", () => {
    runIsolatedProbe(rankProbeSetup + `
      const payload = (name) => ({ meta: { name }, items: [] });
      for (const window of ["week", "month", "year", "all"]) {
        for (const dim of ["repo", "org"]) {
          for (const metric of ["flow", "stock", "growth", "new"]) {
            const liveCapable = dim === "repo" &&
              (window === "month" && ["flow", "stock"].includes(metric) ||
               window === "week" && metric === "flow");
            const period = window === "week" ? "2026-W27" : window === "month" ? "2026-07" : window === "year" ? "2026" : "all";
            const path = "rank/" + window + "/" + period + "/" + dim + "/" + metric + ".json";
            for (overlay of [false, true]) {
              for (base of [null, payload("base")]) {
                for (live of [null, payload("live")]) {
                  const expected = liveCapable && live && (overlay || !base) ? live : base;
                  for (const daily of [false, true]) {
                    calls.length = 0;
                    const result = await rank[daily ? "getRankDaily" : "getRank"](window, period, dim, metric);
                    assert.strictEqual(result, expected);
                    const kinds = !liveCapable ? ["base"] : overlay
                      ? ["watermark", "live", ...(!live ? ["base"] : [])]
                      : ["watermark", "base", ...(!base ? ["live"] : [])];
                    assert.deepEqual(calls.map(c => c.kind), kinds);
                    for (const call of calls) {
                      if (call.kind === "watermark") {
                        assert.deepEqual(call, { kind: "watermark", window, period, versionTtlMs: daily ? ttl : undefined });
                      } else {
                        assert.equal(call.path, path);
                        if (call.kind === "base") {
                          assert.deepEqual(call.opts, daily ? { base: true, versionTtlMs: ttl } : { base: true });
                        } else {
                          assert.deepEqual(call.opts, {
                            live: true, liveHistory: true, legacyPath: "live/" + path,
                            bust: new Date().toISOString().slice(0, 10),
                            ...(daily ? { liveTtlMs: ttl } : {}),
                          });
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `);
  });

  test("reader and watermark failures propagate without probing another source", () => {
    runIsolatedProbe(rankProbeSetup + `
      for (const daily of [false, true]) {
        for (const scenario of [
          { overlay: true, fail: "watermark", order: ["watermark"] },
          { overlay: true, fail: "live", order: ["watermark", "live"] },
          { overlay: true, fail: "base", order: ["watermark", "live", "base"] },
          { overlay: false, fail: "base", order: ["watermark", "base"] },
          { overlay: false, fail: "live", order: ["watermark", "base", "live"] },
        ]) {
          overlay = scenario.overlay;
          failedRead = scenario.fail;
          calls.length = 0;
          await assert.rejects(rank[daily ? "getRankDaily" : "getRank"]("week", "2026-W27", "repo", "flow"), /read failed/);
          assert.deepEqual(calls.map(c => c.kind), scenario.order);
        }
      }
    `);
  });

  test("direct base and authoritative getters retain their policies and signatures", () => {
    runIsolatedProbe(rankProbeSetup + `
      base = { items: [] };
      for (const [getter, kind, opts] of [
        ["getRankBase", "base", { base: true }],
        ["getRankBaseDaily", "base", { base: true, versionTtlMs: ttl }],
        ["getRankBaseAuthoritative", "authoritative", { base: true }],
      ]) {
        calls.length = 0;
        assert.strictEqual(await rank[getter]("month", "2026-07", "org", "stock"), base);
        assert.deepEqual(calls, [{ kind, path: "rank/month/2026-07/org/stock.json", opts }]);
      }
      calls.length = 0;
      assert.strictEqual(await rank.getAllTime("repo"), base);
      assert.deepEqual(calls, [{ kind: "base", path: "rank/all-time/repo/stock.json", opts: { base: true } }]);
      failedRead = "base";
      calls.length = 0;
      await assert.rejects(rank.getRankBaseAuthoritative("week", "2026-W27", "repo", "flow"), /authoritative failed/);
      assert.deepEqual(calls.map(c => c.kind), ["authoritative"]);
    `);
  });
});

describe("lookup read policy", () => {
  test("normal/daily reverse indexes share lowercase, numeric id, collision and missing-data semantics", () => {
    runIsolatedProbe(`
      import assert from "node:assert/strict";
      import { mock } from "bun:test";
      const ttl = 86_400_000;
      let lookup = null;
      let failure = false;
      const calls = [];
      mock.module("./lib/data/source.ts", () => ({
        DAILY_BASE_VIEW_OPTS: { base: true, versionTtlMs: ttl },
        readView: async (path, schema, opts) => {
          calls.push({ kind: "published", path, opts });
          if (failure) throw new Error("lookup failed");
          return lookup;
        },
        readAuthoritativeView: async (path, schema, opts) => {
          calls.push({ kind: "authoritative", path, opts });
          if (failure) throw new Error("lookup failed");
          return lookup;
        },
      }));
      const data = await import("./lib/data/lookup.ts");
      const fixture = {
        "2": { full_name: "Owner/Repo" },
        "17": { full_name: "OWNER/REPO" },
        "42": { full_name: "Other/Project" },
      };
      for (lookup of [null, {}, fixture]) {
        const before = JSON.stringify(lookup);
        for (const daily of [false, true]) {
          calls.length = 0;
          const result = await data[daily ? "getRepoIdByFullNameDaily" : "getRepoIdByFullName"]();
          assert.ok(result instanceof Map);
          assert.deepEqual([...result], lookup === fixture ? [["owner/repo", 17], ["other/project", 42]] : []);
          assert.equal(JSON.stringify(lookup), before);
          assert.deepEqual(calls, [{ kind: "published", path: "lookup/repos.json", opts: daily ? { base: true, versionTtlMs: ttl } : { base: true } }]);
        }
      }
      for (const [getter, path, kind, opts] of [
        ["getReposLookup", "lookup/repos.json", "published", { base: true }],
        ["getOrgsLookup", "lookup/orgs.json", "published", { base: true }],
        ["getReposLookupDaily", "lookup/repos.json", "published", { base: true, versionTtlMs: ttl }],
        ["getAliasMapDaily", "lookup/aliases.json", "published", { base: true, versionTtlMs: ttl }],
        ["getReposLookupAuthoritative", "lookup/repos.json", "authoritative", { base: true }],
      ]) {
        calls.length = 0;
        assert.strictEqual(await data[getter](), lookup);
        assert.deepEqual(calls, [{ kind, path, opts }]);
      }
      failure = true;
      for (const getter of ["getRepoIdByFullName", "getRepoIdByFullNameDaily", "getReposLookupAuthoritative"]) {
        await assert.rejects(data[getter](), /lookup failed/);
      }
    `);
  });
});
