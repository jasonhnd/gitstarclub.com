// @ts-nocheck -- Bun test globals are outside the production JS typecheck roots.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { BOOTSTRAP_POINTER_PATH, bootstrapGenerationPrefix } from "./bootstrap-publication.mjs";
import { ACTIVE_WORKFLOW_PATH } from "./bootstrap-lease.mjs";
import { parseBootstrapArgs, remoteWriteEnabled } from "./bootstrap-cli.mjs";
import { createBackfillFixture, GENERATION, NEXT_GENERATION, REPOSITORIES } from "./test-support/backfill-fixture.mjs";

const fixtures = [];
function fixture() {
  const value = createBackfillFixture();
  fixtures.push(value);
  return value;
}
afterAll(() => { for (const value of fixtures) value.dispose(); });

function succeeds(result) {
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  return result.stdout;
}
function fails(result, message) {
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(message);
}
function pointerWrites(value) {
  return value.trace().filter((entry) => entry.key === BOOTSTRAP_POINTER_PATH && entry.method === "PUT");
}
function r2Args(target = "pre", generation = GENERATION) {
  return ["--store", "r2", "--target", target, "--generation", generation];
}

describe("backfill shared argument parsing", () => {
  test("space-separated and equals values retain every parsed field", () => {
    const pairs = ["--store", "r2", "--target", "prod", "--generation", GENERATION, "--generated-at", "2026-07-17T12:00:00.000Z"];
    const equals = ["--store=r2", "--target=prod", `--generation=${GENERATION}`, "--generated-at=2026-07-17T12:00:00.000Z"];
    const flags = ["--execute", "--initial-commit"];
    expect(parseBootstrapArgs([...equals, ...flags])).toEqual(parseBootstrapArgs([...pairs, ...flags]));
    expect(parseBootstrapArgs([...equals, ...flags])).toMatchObject({
      help: false, store: "r2", target: "prod", generation: GENERATION,
      generatedAt: "2026-07-17T12:00:00.000Z", execute: true, initialCommit: true,
      stageOnly: false, noUpload: false, dryRun: false, rollbackRequested: false,
    });
    expect(parseBootstrapArgs(["--rollback=bootstrap-prior", "--execute"])).toMatchObject({
      rollback: "bootstrap-prior", rollbackRequested: true, execute: true,
    });
  });

  for (const flag of ["--store", "--target", "--generation", "--generated-at", "--rollback"]) {
    test(`${flag} refuses both an absent value and another long flag as its value`, () => {
      expect(() => parseBootstrapArgs([flag])).toThrow(`${flag} requires a value`);
      expect(() => parseBootstrapArgs([flag, "--execute"])).toThrow(`${flag} requires a value`);
    });
  }

  for (const target of ["pre", "prod"]) {
    test(`R2 ${target} write opt-in never overrides dry-run or no-upload`, () => {
      expect(remoteWriteEnabled(parseBootstrapArgs(r2Args(target)))).toBe(false);
      expect(remoteWriteEnabled(parseBootstrapArgs([...r2Args(target), "--stage-only"]))).toBe(false);
      expect(remoteWriteEnabled(parseBootstrapArgs([...r2Args(target), "--initial-commit"]))).toBe(false);
      expect(remoteWriteEnabled(parseBootstrapArgs([...r2Args(target), "--execute"]))).toBe(true);
      expect(remoteWriteEnabled(parseBootstrapArgs([...r2Args(target), "--execute", "--stage-only"]))).toBe(true);
      for (const flag of ["--dry-run", "--no-upload"]) {
        expect(remoteWriteEnabled(parseBootstrapArgs([...r2Args(target), "--execute", flag]))).toBe(false);
      }
    });
  }
});

describe("real 06 and 07 entry points reject unsafe arguments before I/O", () => {
  const cases = [
    [["--store=other"], "--store must be blob or r2"],
    [["--store="], "--store must be blob or r2"],
    [["--store=r2"], "requires --target prod|pre"],
    [["--store=r2", "--target=production"], "--target must be prod or pre"],
    [["--store=r2", "--target="], "--target must be prod or pre"],
    [["--target=pre"], "--target requires --store r2"],
    [["--store=blob", "--initial-commit"], "--initial-commit requires --store r2"],
    [[...r2Args(), "--initial-commit", "--stage-only"], "--initial-commit cannot be combined with --stage-only"],
    [[...r2Args(), "--initial-commit", "--rollback=bootstrap-old"], "--initial-commit cannot be combined with --rollback"],
    [["--rollback=bootstrap-old", "--dry-run"], "--rollback cannot be combined with --dry-run"],
    [["--rollback=bootstrap-old", "--no-upload"], "--rollback cannot be combined with --dry-run or --no-upload"],
    [["--excute"], "unknown argument --excute"],
  ];
  for (const script of ["06-upload.mjs", "07-export-v2.mjs"]) {
    for (const [args, message] of cases) {
      test(`${script} rejects ${args.join(" ")}`, () => {
        const value = fixture();
        fails(value.run(script, args), message);
        expect(value.trace()).toEqual([]);
        expect(existsSync(join(value.data, "v2"))).toBe(false);
        expect(value.remote()).toEqual({});
      });
    }
  }

  test("06 requires a specific generation and refuses traversal before reading views", () => {
    const value = fixture();
    fails(value.run("06-upload.mjs", ["--dry-run"]), "--generation bootstrap-<specific-id> is required");
    fails(value.run("06-upload.mjs", ["--generation=bootstrap-../escape", "--dry-run"]), "invalid bootstrap generation");
    expect(value.trace()).toEqual([]);
  });

  test("07 requires deterministic staging time and a generation even with an explicit time", () => {
    const value = fixture();
    fails(value.run("07-export-v2.mjs", ["--generation=bootstrap-custom"]), "staged upload needs deterministic time");
    fails(value.run("07-export-v2.mjs", ["--generation", GENERATION, "--generated-at=not-a-date"]), "staged upload needs deterministic time");
    fails(value.run("07-export-v2.mjs", ["--generated-at=2026-07-17T12:00:00.000Z"]), "is required for staging, resume, and commit");
    expect(value.trace()).toEqual([]);
  });

  test("07 rollback requires execute and an explicit generation or legacy-flat", () => {
    const value = fixture();
    fails(value.run("07-export-v2.mjs", ["--rollback=bootstrap-prior"]), "bootstrap rollback requires --execute");
    for (const target of ["", "latest", "current"]) {
      fails(value.run("07-export-v2.mjs", [`--rollback=${target}`, "--execute"]), "requires an explicit target");
    }
    expect(value.trace()).toEqual([]);
    expect(existsSync(join(value.data, "v2"))).toBe(false);
  });
});

describe("steps 01 through 03 offline entry points", () => {
  test("01 honors the default star floor and writes the sorted synthetic whitelist", () => {
    const value = fixture();
    value.configure({ github: true });
    expect(succeeds(value.run("01-whitelist.mjs", [], { GITHUB_TOKEN: "offline-fixture-token" }))).toContain("3 repos >= 10000");
    expect(value.trace()[0].query).toBe("stars:>=10000");
    const whitelist = value.readData("whitelist.json");
    expect(whitelist.map((repo) => repo.id)).toEqual([132750724, 11730342, 33]);
    expect(whitelist[0]).toEqual({ id: 132750724, node_id: "node-top", full_name: "acme/top", owner: "acme", name: "top", stars: 100000 });
  });

  test("01 accepts a positive floor override and refuses malformed overrides before fetch", () => {
    const value = fixture();
    value.configure({ github: true });
    succeeds(value.run("01-whitelist.mjs", [], { GITHUB_TOKEN: "offline-fixture-token", MIN_TRACKED_STARS: " 20000 " }));
    expect(value.trace()[0].query).toBe("stars:>=20000");
    value.clearTrace();
    for (const raw of ["0", "-1", "1.5", "1e4", "9007199254740992"]) {
      fails(value.run("01-whitelist.mjs", [], { MIN_TRACKED_STARS: raw }), "MIN_TRACKED_STARS must be a positive integer");
    }
    expect(value.trace()).toEqual([]);
  });

  test("01 missing token or incomplete Search results cannot emit a whitelist", () => {
    const value = fixture();
    fails(value.run("01-whitelist.mjs"), "GITHUB_TOKEN not set");
    value.configure({ github: true, incompleteSearch: true });
    fails(value.run("01-whitelist.mjs", [], { GITHUB_TOKEN: "offline-fixture-token" }), "GitHub Search returned incomplete results");
    expect(existsSync(join(value.data, "whitelist.json"))).toBe(false);
  });

  test("02 renders equivalent space and equals arguments locally and offers help", () => {
    const value = fixture();
    const args = ["--cutoff-suffix", "260531", "--destination", "gitstarclub.star_daily_gross_260531"];
    const spaced = succeeds(value.run("02-extract.mjs", args));
    const equals = succeeds(value.run("02-extract.mjs", ["--cutoff-suffix=260531", "--destination=gitstarclub.star_daily_gross_260531"]));
    expect(equals).toBe(spaced);
    expect(spaced).toContain("CREATE OR REPLACE TABLE `gitstarclub.star_daily_gross_260531`");
    expect(spaced).toContain("BETWEEN '150101' AND '260531'");
    expect(spaced).not.toContain("@@");
    expect(spaced.endsWith("\n")).toBe(true);
    expect(succeeds(value.run("02-extract.mjs", ["-h"]))).toContain("Does not query BigQuery");
    expect(value.trace()).toEqual([]);
  });

  test("02 rejects unknown, missing, and unsafe parameters without any query", () => {
    const value = fixture();
    fails(value.run("02-extract.mjs", ["--execute"]), "unknown argument --execute");
    fails(value.run("02-extract.mjs", ["--cutoff-suffix"]), "6-digit YYMMDD");
    fails(value.run("02-extract.mjs", ["--cutoff-suffix=260531", "--destination"]), "--destination is required");
    fails(value.run("02-extract.mjs", ["--cutoff-suffix=260531", "--destination=gitstarclub.star_daily_gross"]), "refusing to overwrite");
    expect(value.trace()).toEqual([]);
  });

  test("03 uses GraphQL metadata over stale Search names and star counts", () => {
    const value = fixture();
    value.configure({ github: true });
    value.writeData("whitelist.json", REPOSITORIES.map((repo) => ({ ...repo, full_name: "stale/name", stars: 999999 })));
    succeeds(value.run("03-metadata.mjs", [], { GITHUB_TOKEN: "offline-fixture-token" }));
    const repos = value.readData("repos.json");
    expect(repos).toHaveLength(3);
    expect(repos[0]).toMatchObject({
      id: 132750724, node_id: "node-top", owner: "acme", name: "top", full_name: "acme/top",
      owner_type: "Organization", current_stars: 100000, active: true, tracked_since: null,
      is_archived: false, description: null, topics: ["offline-fixture"],
    });
    expect(repos[1].language).toBeNull();
    expect(repos[0].stars).toBeUndefined();
    expect(Number.isFinite(Date.parse(repos[0].fetched_at))).toBe(true);
    expect(value.trace().map((entry) => entry.path)).toEqual(["/graphql"]);
  });

  test("03 missing metadata or a GraphQL error preserves existing repos.json", () => {
    const value = fixture();
    value.writeData("whitelist.json", REPOSITORIES);
    value.writeData("repos.json", { sentinel: true });
    value.configure({ github: true, missingNode: "node-vue" });
    fails(value.run("03-metadata.mjs", [], { GITHUB_TOKEN: "offline-fixture-token" }), "GraphQL metadata missing for 1 active repository(s): vuejs/vue (11730342)");
    expect(value.readData("repos.json")).toEqual({ sentinel: true });
    value.configure({ missingNode: null, githubError: true });
    fails(value.run("03-metadata.mjs", [], { GITHUB_TOKEN: "offline-fixture-token" }), "GraphQL errors");
    expect(value.readData("repos.json")).toEqual({ sentinel: true });
  });

  test("03 missing whitelist fails before any fetch or metadata write", () => {
    const value = fixture();
    fails(value.run("03-metadata.mjs"), "ENOENT");
    expect(value.trace()).toEqual([]);
    expect(existsSync(join(value.data, "repos.json"))).toBe(false);
  });
});

describe("local DuckDB rollup, precompute, and publication commands", () => {
  let baseline;
  let rollupOutput;
  let precomputeOutput;
  beforeAll(async () => {
    baseline = fixture();
    await baseline.seedParquet();
    rollupOutput = succeeds(baseline.run("04-rollup.mjs"));
    precomputeOutput = succeeds(baseline.run("05-precompute.mjs"));
  });

  function localFixture() {
    const value = fixture();
    cpSync(baseline.data, value.data, { recursive: true });
    return value;
  }

  test("04 preserves gross facts and records the first threshold-crossing dates", async () => {
    expect(rollupOutput).toContain("milestones for 3 repos merged");
    expect(baseline.readData("repos.json")[0]).toMatchObject({
      ...REPOSITORIES[0], crossed_10k: "2024-02-29", crossed_50k: "2025-12-31", crossed_100k: "2026-01-01",
    });
    expect(baseline.readData("repos.json")[1]).toMatchObject({ crossed_10k: "2024-02-28", crossed_50k: "2025-12-31", crossed_100k: null });
    const db = await DuckDBInstance.create();
    const con = await db.connect();
    try {
      const path = join(baseline.data, "star_daily.parquet").replaceAll("'", "''");
      const reader = await con.runAndReadAll(`SELECT COUNT(*) count, SUM(delta) total, CAST(MAX(date) AS VARCHAR) last_day FROM read_parquet('${path}')`);
      expect(reader.getRowObjects()).toEqual([{ count: 9n, total: 180000n, last_day: "2026-01-01" }]);
    } finally {
      con.closeSync();
      db.closeSync();
    }
    expect(baseline.trace()).toEqual([]);
  });

  test("04 missing parquet fails without rewriting the repo dimension", () => {
    const value = fixture();
    value.writeData("repos.json", REPOSITORIES);
    fails(value.run("04-rollup.mjs"), "No files found");
    expect(value.readData("repos.json")).toEqual(REPOSITORIES);
    expect(value.trace()).toEqual([]);
  });

  test("05 anchors repo stock, carries idle org members, and spans the year seam", () => {
    expect(precomputeOutput).toContain("anchor_drift: repo=0 org=0");
    const vue = baseline.readData("views/entity/repo/11730342.json");
    expect(vue.curve.monthly.at(-1)).toEqual(["2026-01", 20000, 60000]);
    expect(vue.curve.recent_daily).toEqual([["2025-12-31", 30000], ["2026-01-01", 20000]]);
    expect(vue.milestones.crossed_100k).toBeNull();
    const acme = baseline.readData("views/entity/org/acme.json");
    expect(acme.curve.monthly.at(-1)).toEqual(["2026-01", 50000, 110000]);
    expect(acme.members).toEqual([132750724, 33]);
    expect(baseline.readData("views/rank/month/2026-01/repo/flow.json").items[0]).toMatchObject({ rank: 1, id: 132750724, value: 50000 });
    expect(baseline.readData("views/meta.json").seam_date).toBe("2026-01-02");
    expect(baseline.readData("views/heatmap/year/2025.json").cells).toEqual([["2025-12", 70000]]);
  });

  test("05 missing repo input fails before emitting views", () => {
    const value = fixture();
    fails(value.run("05-precompute.mjs"), "No files found");
    expect(existsSync(join(value.data, "views"))).toBe(false);
    expect(value.trace()).toEqual([]);
  });

  for (const target of ["pre", "prod"]) {
    for (const script of ["06-upload.mjs", "07-export-v2.mjs"]) {
      test(`${script} defaults to R2 ${target} dry run with zero fetches or writes`, () => {
        const value = localFixture();
        const output = succeeds(value.run(script, r2Args(target), { R2_BUCKET: `fixture-${target}` }));
        expect(output).toContain(`store=r2 target=${target} bucket=fixture-${target}`);
        expect(output).toContain("writes=0");
        expect(output).toContain("credentials unset");
        expect(value.trace()).toEqual([]);
        expect(value.remote()).toEqual({});
        if (script === "07-export-v2.mjs") {
          const canonical = value.readData("v2/canonical/v2/meta.json");
          expect(canonical).toEqual({ seam_date: "2026-01-02", schema_ver: 1,
            folded_through: { month: "2026-01", week: "2026-W01" }, generated_at: "2026-07-17T12:00:00.000Z" });
          expect(value.readData("v2/canonical/v2/repos/6.json")[11730342].d).toBe(60000 / 70000);
          expect(value.readData("v2/canonical/v2/repo-monthly/1.json")[33]).toEqual([["2024-03", 10000]]);
        }
      });
    }
  }

  test("explicit dry run and no-upload suppress execute, while stage-only alone stays dry", () => {
    const value = localFixture();
    const env = value.seedR2();
    for (const flag of ["--dry-run", "--no-upload"]) {
      for (const script of ["06-upload.mjs", "07-export-v2.mjs"]) {
        value.clearTrace();
        expect(succeeds(value.run(script, [...r2Args(), "--execute", flag], env))).toContain("writes=0");
        expect(value.trace().map((entry) => [entry.method, entry.key])).toEqual([["GET", "_meta/bucket-identity.json"]]);
      }
    }
    value.clearTrace();
    succeeds(value.run("07-export-v2.mjs", [...r2Args(), "--stage-only"], env));
    expect(value.trace().every((entry) => entry.method === "GET")).toBe(true);
    expect(value.readRemote(BOOTSTRAP_POINTER_PATH)).toBeNull();
  }, 20000);

  test("Blob compatibility keeps default upload and local no-upload separate", () => {
    const value = localFixture();
    fails(value.run("06-upload.mjs", ["--generation", GENERATION]), "BLOB_READ_WRITE_TOKEN not set");
    fails(value.run("07-export-v2.mjs", ["--generation", GENERATION]), "BLOB_READ_WRITE_TOKEN not set");
    expect(succeeds(value.run("06-upload.mjs", ["--generation", GENERATION, "--dry-run"]))).toContain("nothing uploaded");
    expect(succeeds(value.run("07-export-v2.mjs", ["--no-upload"]))).toContain("skipped Blob staging and commit");
    expect(value.trace()).toEqual([]);
  }, 20000);

  test("invalid views and invalid canonical output fail before remote staging", () => {
    const value = localFixture();
    const env = value.seedR2();
    value.writeData("views/meta.json", { seam_date: "not-a-date" });
    fails(value.run("06-upload.mjs", [...r2Args(), "--execute"], env), "view validation failed");
    value.writeData("repos.json", [{ ...REPOSITORIES[0], current_stars: -1 }]);
    fails(value.run("07-export-v2.mjs", [...r2Args(), "--execute", "--initial-commit"], env), "canonical validation failed");
    expect(value.trace()).toEqual([]);
    expect(Object.keys(value.remote())).toEqual(["_meta/bucket-identity.json"]);
  });

  for (const target of ["pre", "prod"]) {
    test(`R2 ${target} stage-only and first commit use real validators and the shared lease`, () => {
      const value = localFixture();
      const env = value.seedR2(target);
      succeeds(value.run("06-upload.mjs", [...r2Args(target), "--execute"], env));
      expect(value.readRemote(BOOTSTRAP_POINTER_PATH)).toBeNull();
      value.clearTrace();
      expect(succeeds(value.run("07-export-v2.mjs", [...r2Args(target), "--execute", "--stage-only"], env))).toContain("production pointer unchanged");
      expect(value.readRemote(BOOTSTRAP_POINTER_PATH)).toBeNull();
      expect(value.trace().some((entry) => entry.key === ACTIVE_WORKFLOW_PATH)).toBe(false);
      value.clearTrace();
      const output = succeeds(value.run("07-export-v2.mjs", [...r2Args(target), "--execute", "--initial-commit"], env));
      expect(output).toContain(`published: generation=${GENERATION} previous=null`);
      expect(output).toContain("required_shards=128/128");
      expect(value.readRemote(BOOTSTRAP_POINTER_PATH)).toMatchObject({ generation: GENERATION, previous_generation: null });
      expect(pointerWrites(value)).toHaveLength(1);
      expect(pointerWrites(value)[0].ifNoneMatch).toBe("*");
      const trace = value.trace();
      const pointerIndex = trace.findIndex((entry) => entry.key === BOOTSTRAP_POINTER_PATH && entry.method === "PUT");
      expect(trace.slice(0, pointerIndex).some((entry) => entry.key === ACTIVE_WORKFLOW_PATH && entry.method === "PUT")).toBe(true);
      expect(value.readRemote(ACTIVE_WORKFLOW_PATH)).toMatchObject({ status: "published", fencing_token: 1 });
      value.clearTrace();
      expect(succeeds(value.run("07-export-v2.mjs", [...r2Args(target), "--execute", "--initial-commit"], env))).toContain("already-published");
      expect(pointerWrites(value)).toEqual([]);
    }, 20000);
  }

  for (const marker of ["views/latest.json", "canonical/v2/meta.json"]) {
    test(`07 initial commit refuses mixed marker ${marker} and retains an absent pointer`, () => {
      const value = localFixture();
      const env = value.seedR2();
      succeeds(value.run("06-upload.mjs", [...r2Args(), "--execute"], env));
      value.setRemote(marker, { existing: true });
      value.clearTrace();
      fails(value.run("07-export-v2.mjs", [...r2Args(), "--execute", "--initial-commit"], env), `${marker} already exists`);
      expect(pointerWrites(value)).toEqual([]);
      expect(value.readRemote(BOOTSTRAP_POINTER_PATH)).toBeNull();
      expect(value.readRemote(marker)).toEqual({ existing: true });
      expect(value.readRemote(ACTIVE_WORKFLOW_PATH).status).toBe("failed");
    }, 15000);
  }

  test("07 initial commit is blocked by a running managed refresh lease", () => {
    const value = localFixture();
    const env = value.seedR2();
    succeeds(value.run("06-upload.mjs", [...r2Args(), "--execute"], env));
    const active = { run_id: "managed-refresh", status: "running", expires_at: "2099-01-01T00:00:00.000Z", fencing_token: 42 };
    value.setRemote(ACTIVE_WORKFLOW_PATH, active);
    value.clearTrace();
    fails(value.run("07-export-v2.mjs", [...r2Args(), "--execute", "--initial-commit"], env), "blocked by active workflow managed-refresh");
    expect(pointerWrites(value)).toEqual([]);
    expect(value.readRemote(BOOTSTRAP_POINTER_PATH)).toBeNull();
    expect(value.readRemote(ACTIVE_WORKFLOW_PATH)).toEqual(active);
  }, 15000);

  test("07 refuses a corrupted base object before publishing", () => {
    const value = localFixture();
    const env = value.seedR2();
    succeeds(value.run("06-upload.mjs", [...r2Args(), "--execute"], env));
    value.setRemote(`${bootstrapGenerationPrefix(GENERATION)}/views/meta.json`, { corrupted: true });
    value.clearTrace();
    fails(value.run("07-export-v2.mjs", [...r2Args(), "--execute", "--initial-commit"], env), "immutable staged object differs from its manifest");
    expect(pointerWrites(value)).toEqual([]);
    expect(value.readRemote(BOOTSTRAP_POINTER_PATH)).toBeNull();
  }, 15000);

  test("07 rollback switches a verified generation, retries current without a pointer write, and refuses digest drift", () => {
    const value = localFixture();
    const env = value.seedR2();
    succeeds(value.run("06-upload.mjs", [...r2Args(), "--execute"], env));
    succeeds(value.run("07-export-v2.mjs", [...r2Args(), "--execute", "--initial-commit"], env));
    succeeds(value.run("06-upload.mjs", [...r2Args("pre", NEXT_GENERATION), "--execute"], env));
    value.clearTrace();
    fails(value.run("07-export-v2.mjs", [...r2Args("pre", NEXT_GENERATION), "--execute", "--initial-commit"], env), "bootstrap/latest.json already exists");
    expect(pointerWrites(value)).toEqual([]);
    succeeds(value.run("07-export-v2.mjs", [...r2Args("pre", NEXT_GENERATION), "--execute"], env));
    expect(value.readRemote(BOOTSTRAP_POINTER_PATH)).toMatchObject({ generation: NEXT_GENERATION, previous_generation: GENERATION });
    value.clearTrace();
    const args = ["--store=r2", "--target=pre", `--rollback=${GENERATION}`, "--execute"];
    expect(succeeds(value.run("07-export-v2.mjs", args, env))).toContain(`rolled-back: target=${GENERATION}`);
    expect(value.readRemote(BOOTSTRAP_POINTER_PATH)).toMatchObject({ generation: GENERATION, previous_generation: NEXT_GENERATION });
    expect(pointerWrites(value)).toHaveLength(1);
    value.clearTrace();
    expect(succeeds(value.run("07-export-v2.mjs", args, env))).toContain("already-rolled-back");
    expect(pointerWrites(value)).toEqual([]);
    value.setRemote(BOOTSTRAP_POINTER_PATH, { ...value.readRemote(BOOTSTRAP_POINTER_PATH), base_manifest_sha256: "0".repeat(64) });
    const before = value.remote()[BOOTSTRAP_POINTER_PATH];
    value.clearTrace();
    fails(value.run("07-export-v2.mjs", args, env), "current generation manifest digest changed");
    expect(pointerWrites(value)).toEqual([]);
    expect(value.remote()[BOOTSTRAP_POINTER_PATH]).toBe(before);
  }, 30000);
});
