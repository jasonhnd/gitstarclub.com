import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bootstrapGenerationPrefix, buildBootstrapPhaseManifest, sha256Bytes } from "../../pipeline/lib/bootstrap-publication.mjs";
import { main, parsePublishArgs, publishRepairGeneration, type CfRunner } from "../scripts/publish-repair-generation";

const ok = (stdout: Buffer) => ({ code: 0, stdout, stderr: "" });
const child = { env: { ...process.env, CF_DELEGATION: "1" } };
const scratch: string[] = [];
afterEach(() => { for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true }); });
const generation = "bootstrap-publish-fixture", prefix = bootstrapGenerationPrefix(generation);
function fixture() {
  const built = mkdtempSync(join(tmpdir(), "publisher-test-")); scratch.push(built);
  const bytes = new Map<string, Buffer>();
  const write = (key: string, body: Buffer) => {
    const file = join(built, key); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, body); bytes.set(key, body);
  };
  for (const phase of ["base", "canonical"]) {
    const items = Array.from({ length: 6 }, (_, i) => ({ path: `${phase === "base" ? "views" : "canonical/v2"}/${i}.json`, body: Buffer.from(`{"value":${i}}`) }));
    for (const item of items) write(`${prefix}/${item.path}`, item.body);
    write(`${prefix}/manifests/${phase}.json`, Buffer.from(JSON.stringify(buildBootstrapPhaseManifest(generation, phase, items))));
  }
  return { options: { built, generation, bucket: "fake-bucket", concurrency: 2 }, bytes, write };
}
function fakeCf(seed = new Map<string, Buffer>(), delay = 0) {
  const objects = new Map(seed), calls: string[][] = [];
  let active = 0, peak = 0;
  const runner: CfRunner = async (args) => {
    calls.push([...args]); active++; peak = Math.max(peak, active);
    try {
      if (delay) await new Promise((done) => setTimeout(done, delay));
      expect(args.slice(0, 2)).toEqual(["r2", "objects"]);
      expect(args[args.indexOf("--bucket-name") + 1]).toBe("fake-bucket");
      const operation = args[2], key = args[3];
      if (operation === "list") {
        const prefix = args[args.indexOf("--prefix") + 1];
        expect(args[args.indexOf("--per-page") + 1]).toBe("1000");
        expect(args).not.toContain("--cursor");
        return ok(Buffer.from(JSON.stringify([...objects.keys()].filter((key) => key.startsWith(prefix)).slice(0, 1000).map((key) => ({ key })))));
      }
      if (operation === "get") { const body = objects.get(key); if (!body) throw new Error("not found"); return ok(body); }
      if (operation === "put") {
        // A put to an existing key is a test failure, even for identical bytes.
        expect(objects.has(key)).toBe(false);
        expect(calls.some((call) => call[2] === "list" && call[call.indexOf("--prefix") + 1] === key)).toBe(true);
        if (key.includes("/manifests/")) {
          const manifest = JSON.parse(readFileSync(args[args.indexOf("--file") + 1], "utf8"));
          for (const item of manifest.objects) expect(objects.has(`${prefix}/${item.path}`)).toBe(true);
        }
        objects.set(key, readFileSync(args[args.indexOf("--file") + 1])); return ok(Buffer.from("{}"));
      }
      throw new Error(`Unexpected cf operation ${operation}`);
    } finally { active--; }
  };
  return { runner, calls, objects, peak: () => peak, active: () => active };
}

test("publishes exact verified bytes and seals manifests after their objects", async () => {
  const { options, bytes } = fixture(), cf = fakeCf();
  expect(await publishRepairGeneration(options, cf.runner)).toEqual({ created: 14, skipped: 0, planned: 0 });
  expect(cf.objects).toEqual(bytes);
  expect(cf.calls.filter((call) => call[2] === "put")).toHaveLength(14);
});

for (const mutation of ["missing manifest", "wrong phase", "wrong generation", "duplicate object", "bad total", "bad sha", "missing object", "same-size changed bytes", "changed size", "traversal", "symlink"]) {
  test(`refuses ${mutation} before any cf call`, async () => {
    const { options, write } = fixture(), cf = fakeCf();
    const key = `${prefix}/manifests/canonical.json`, path = join(options.built, key);
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    if (mutation === "missing manifest") rmSync(path);
    else if (mutation === "missing object") rmSync(join(options.built, prefix, "canonical/v2/5.json"));
    else if (mutation === "same-size changed bytes") write(`${prefix}/canonical/v2/5.json`, Buffer.from('{"value":9}'));
    else if (mutation === "changed size") write(`${prefix}/canonical/v2/5.json`, Buffer.from("{}"));
    else if (mutation === "symlink") {
      const target = join(options.built, prefix, "canonical/v2/5.json"); rmSync(target); symlinkSync("4.json", target);
    } else {
      if (mutation === "wrong phase") manifest.phase = "base";
      if (mutation === "wrong generation") manifest.generation = "bootstrap-other";
      if (mutation === "duplicate object") manifest.objects[1] = manifest.objects[0];
      if (mutation === "bad total") manifest.total_bytes++;
      if (mutation === "bad sha") manifest.objects[5].sha256 = "0".repeat(64);
      if (mutation === "traversal") manifest.objects[0].path = "canonical/v2/../../outside.json";
      write(key, Buffer.from(JSON.stringify(manifest)));
    }
    await expect(publishRepairGeneration(options, cf.runner)).rejects.toThrow();
    expect(cf.calls).toHaveLength(0);
  });
}

for (const existing of ["views/0.json", "manifests/base.json", "canonical/v2/0.json", "manifests/canonical.json"]) {
  test(`refuses existing different bytes at ${existing} without overwriting or continuing`, async () => {
    const { options } = fixture(), key = `${prefix}/${existing}`;
    const cf = fakeCf(new Map([[key, Buffer.from('{"value":9}')]]), 1);
    await expect(publishRepairGeneration(options, cf.runner)).rejects.toThrow("Existing object differs");
    expect(cf.objects.get(key)?.toString()).toBe('{"value":9}');
    expect(cf.calls.some((call) => call[2] === "put" && call[3] === key)).toBe(false);
    expect(cf.active()).toBe(0);
    const count = cf.calls.length;
    await new Promise((done) => setTimeout(done, 5)); expect(cf.calls).toHaveLength(count);
  });
}

test("resumes partially uploaded objects and skips a complete generation including manifests", async () => {
  const { options, bytes } = fixture();
  const cf = fakeCf(new Map([...bytes].slice(0, 3)));
  expect(await publishRepairGeneration(options, cf.runner)).toEqual({ created: 11, skipped: 3, planned: 0 });
  cf.calls.length = 0;
  expect(await publishRepairGeneration(options, cf.runner)).toEqual({ created: 0, skipped: 14, planned: 0 });
  expect(cf.calls.every((call) => call[2] !== "put")).toBe(true);
});

test("dry-run lists key, size and SHA-256 for objects and manifests without cf calls", async () => {
  const { options, bytes } = fixture(), cf = fakeCf(), lines: string[] = [];
  await main(["--built", options.built, "--generation", generation, "--bucket", options.bucket, "--dry-run"], cf.runner, (line) => lines.push(line));
  expect(lines.slice(0, -1).map((line) => JSON.parse(line))).toEqual([...bytes].map(([key, body]) => ({ key, size: body.length, sha256: sha256Bytes(body) })));
  expect(JSON.parse(lines.at(-1)!)).toEqual({ created: 0, skipped: 0, planned: 14 });
  expect(cf.calls).toHaveLength(0);
});

for (const concurrency of [1, 2, 4]) {
  test(`respects parallelism bound ${concurrency}`, async () => {
    const { options } = fixture(), cf = fakeCf(new Map(), 2);
    await publishRepairGeneration({ ...options, concurrency }, cf.runner);
    expect(cf.peak()).toBe(concurrency); expect(cf.active()).toBe(0);
  });
}

test("command errors and malformed listings never cause a put", async () => {
  const { options } = fixture();
  for (const response of [null, "not JSON", "null", "{}", '{"objects":[],"truncated":false}', '[null]', '[{}]', '[{"key":1}]', '[{"key":"outside-prefix"}]']) {
    const calls: string[][] = [];
    const runner: CfRunner = async (args) => { calls.push(args); if (response === null) throw new Error("access denied"); return ok(Buffer.from(response)); };
    await expect(publishRepairGeneration(options, runner)).rejects.toThrow();
    expect(calls.every((call) => call[2] === "list")).toBe(true);
  }
});

test("a short page with only prefix children means the exact key is absent", async () => {
  const { options } = fixture();
  const children = new Map([0, 1].map((i) => [`${prefix}/views/${i}.json/child`, Buffer.from("child")]));
  const cf = fakeCf(children);
  expect((await publishRepairGeneration(options, cf.runner)).created).toBe(14);
  expect(cf.calls.some((call) => call[2] === "get")).toBe(false);
  for (const [key, body] of children) expect(cf.objects.get(key)).toEqual(body);
});

test("a full page without the exact key is ambiguous and never causes a put", async () => {
  const { options } = fixture(), calls: string[][] = [];
  const runner: CfRunner = async (args) => {
    calls.push(args);
    const key = args[args.indexOf("--prefix") + 1];
    return ok(Buffer.from(JSON.stringify(Array.from({ length: 1000 }, (_, i) => ({ key: `${key}/child-${i}` })))));
  };
  await expect(publishRepairGeneration(options, runner)).rejects.toThrow("Incomplete cf object listing");
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((call) => call[2] === "list")).toBe(true);
});

test("exact presence on a full page is sufficient to compare existing bytes", async () => {
  const { options, bytes } = fixture(), cf = fakeCf(bytes);
  const runner: CfRunner = async (args) => {
    if (args[2] !== "list") return cf.runner(args, child);
    const key = args[args.indexOf("--prefix") + 1];
    return ok(Buffer.from(JSON.stringify([{ key }, ...Array.from({ length: 999 }, (_, i) => ({ key: `${key}/child-${i}` }))])));
  };
  expect((await publishRepairGeneration(options, runner)).skipped).toBe(14);
  expect(cf.calls.every((call) => call[2] === "get")).toBe(true);
});

test("validates every listing entry even after finding the exact key", async () => {
  const { options } = fixture(), calls: string[][] = [];
  const runner: CfRunner = async (args) => {
    calls.push(args);
    const key = args[args.indexOf("--prefix") + 1];
    return ok(Buffer.from(JSON.stringify([{ key }, { key: "outside-prefix" }])));
  };
  await expect(publishRepairGeneration(options, runner)).rejects.toThrow("Invalid cf object listing");
  expect(calls.every((call) => call[2] === "list")).toBe(true);
});

for (const input of ["views/0.json", "manifests/base.json"]) {
  test(`refuses oversized ${input} before any cf call`, async () => {
    const { options } = fixture(), cf = fakeCf();
    // Sparse file exercises the real size check without allocating a 300 MB body.
    truncateSync(join(options.built, prefix, input), 300_000_001);
    await expect(publishRepairGeneration(options, cf.runner)).rejects.toThrow("Object exceeds cf 300 MB body limit");
    expect(cf.calls).toHaveLength(0);
  });
}

test("runCf pins its child environment and preserves argv without invoking cf", () => {
  // Replace process execution only in a subprocess, keeping other tests isolated.
  const code = `
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    import { promisify } from "node:util";
    const execFile = () => { throw new Error("Unexpected real execFile"); };
    execFile[promisify.custom] = async (file, args, options) => {
      console.log(JSON.stringify({ file, args, delegation: options.env.CF_DELEGATION, inherited: options.env.PUBLISHER_TEST_MARKER }));
      return { stdout: Buffer.from("[]"), stderr: Buffer.alloc(0) };
    };
    childProcess.execFile = execFile;
    syncBuiltinESMExports();
    const { runCf } = await import(${JSON.stringify(join(import.meta.dir, "../scripts/repair-publish-cf.ts"))});
    console.log((await runCf(["r2", "objects", "get", "key with spaces; literal"], { env: process.env })).stdout.toString());
    if (process.env.CF_DELEGATION !== "0") throw new Error("Changed parent environment");
  `;
  const child = Bun.spawnSync(["node", "--input-type=module", "--eval", code], {
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, CF_DELEGATION: "0", PUBLISHER_TEST_MARKER: "inherited" }, stdout: "pipe", stderr: "pipe",
  });
  expect(child.stderr.toString()).toBe("");
  expect(child.exitCode).toBe(0);
  const [invocation, stdout] = child.stdout.toString().trim().split("\n");
  expect(JSON.parse(invocation)).toEqual({
    file: join(import.meta.dir, "../node_modules/.bin/cf"),
    args: ["r2", "objects", "get", "key with spaces; literal"], delegation: "1", inherited: "inherited",
  });
  expect(stdout).toBe("[]");
});

test("uses verified snapshot bytes if local input changes after verification", async () => {
  const { options, bytes, write } = fixture(), cf = fakeCf();
  const key = `${prefix}/views/0.json`, original = bytes.get(key)!;
  const runner: CfRunner = async (args) => { write(key, Buffer.from("changed")); return cf.runner(args, child); };
  await publishRepairGeneration(options, runner);
  expect(cf.objects.get(key)).toEqual(original);
});

test("rejects invalid or duplicate CLI options and invalid parallelism", () => {
  const args = ["--built", "local", "--generation", generation, "--bucket", "fake-bucket"];
  expect(parsePublishArgs(args).concurrency).toBe(4);
  for (const extra of [["--target", "production"], ["--bucket", "other"], ["--concurrency", "0"], ["--concurrency", "1.5"], ["--concurrency", "33"], ["--dry-run", "--dry-run"]]) {
    expect(() => parsePublishArgs([...args, ...extra])).toThrow();
  }
});

test("an interrupted put leaves the phase unsealed and can resume", async () => {
  const { options } = fixture(), cf = fakeCf();
  let injected = false;
  const runner: CfRunner = async (args) => {
    if (args[2] === "put" && args[3].endsWith("views/3.json") && !injected) {
      injected = true; throw new Error("injected upload failure");
    }
    return cf.runner(args, child);
  };
  await expect(publishRepairGeneration(options, runner)).rejects.toThrow("injected upload failure");
  expect(cf.objects.has(`${prefix}/manifests/base.json`)).toBe(false);
  expect(cf.calls.some((call) => call.some((arg) => arg.includes("canonical/v2/")))).toBe(false);
  expect((await publishRepairGeneration(options, runner)).skipped).toBeGreaterThan(0);
  expect(cf.objects.size).toBe(14);
});

test("CLI refusal exits nonzero before it can invoke cf", () => {
  const child = Bun.spawnSync([process.execPath, "--no-env-file", join(import.meta.dir, "../scripts/publish-repair-generation.ts")],
    { env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR }, stdout: "pipe", stderr: "pipe" });
  expect(child.exitCode).toBe(1);
  expect(child.stderr.toString()).toContain("Required:");
});
