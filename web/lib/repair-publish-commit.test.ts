import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACTIVE_WORKFLOW_PATH as ACTIVE } from "../../pipeline/lib/bootstrap-lease.mjs";
import { bootstrapGenerationPrefix, buildBootstrapPhaseManifest, sha256Bytes, verifyBootstrapGeneration } from "../../pipeline/lib/bootstrap-publication.mjs";
import { commitPointer, publishRepairGeneration, RepairPublication, sealRecoveryGeneration, RECOVERY_BASE_PREFIX as BASE, RECOVERY_CANONICAL_KEYS, RepairPublicationError, type CfRunner } from "../scripts/repair-publish-commit";

const GEN = "bootstrap-repair-824b", RECOVERY = "bootstrap-recovery-824b";
const POINTER = "bootstrap/latest.json", NOW = Date.parse("2026-10-26T12:00:00Z");
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const scratch: string[] = [];
afterEach(() => { for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true }); });

// cf beta.18: Gr's errors[] and fallback messages inside blocks.l's raw box.
function boxedError(key: string, status = 404, fallback = false, colour = false) {
  const red = (text: string) => colour ? `\u001b[31m${text}\u001b[39m` : text;
  const bold = (text: string) => colour ? `\u001b[1m${text}\u001b[22m` : text;
  const muted = (text: string) => colour ? `\u001b[2m${text}\u001b[22m` : text;
  const message = fallback ? red(bold(`Status code: ${status}\nBody: {"message":"404 in upstream body"}`))
    : `${red(bold(status === 404 ? "[10007]" : "[10000]"))} ${bold(status === 404 ? "The specified key does not exist." : "Upstream body mentions 404")}`;
  const http = `${status} ${status === 429 ? "Too Many Requests" : status === 404 ? "Not Found" : "Internal Server Error"} · HTTP /accounts/fake/r2/buckets/fake-bucket/objects/${key}`;
  return `\n${red("┌")} ${red(bold("APIError"))}\n${`${message}\n${muted(http)}`.split("\n").map((line) => `${red("│")} ${line}`).join("\n")}\n${red("└")}\n`;
}

function fixture() {
  const workDir = mkdtempSync(join(tmpdir(), "repair-824b-")); scratch.push(workDir);
  const objects = new Map<string, Buffer>();
  const writes: Array<{ key: string; body: Buffer }> = [], calls: string[][] = [];
  let clock = NOW;
  let hook: ((args: string[]) => void | Promise<void>) | undefined;
  let afterPut: ((key: string) => void) | undefined;
  let failure: string | undefined;
  let badListing = false;
  let listOverride: ((key: string) => unknown) | undefined;
  const runCf: CfRunner = async (args, child) => {
    expect(child.env.CF_DELEGATION).toBe("1");
    calls.push([...args]); await hook?.(args);
    expect(args.slice(0, 2)).toEqual(["r2", "objects"]);
    expect(args[args.indexOf("--bucket-name") + 1]).toBe("fake-bucket");
    if (args[2] === failure) return { code: 1, stdout: "", stderr: "injected failure" };
    let stdout = "";
    if (args[2] === "list") {
      const prefix = args[args.indexOf("--prefix") + 1];
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
      expect(args.includes("--cursor")).toBe(false);
      expect(args.includes("--delimiter")).toBe(false);
      const count = Number(args[args.indexOf("--per-page") + 1]);
      // Real beta.18 stdout: a pretty JSON ARRAY plus console.log's newline.
      stdout = JSON.stringify(badListing ? { objects: [], truncated: false } : listOverride?.(prefix) ??
        keys.slice(0, count).map((key) => ({ key, size: objects.get(key)!.length })), null, 2) + "\n";
    } else if (args[2] === "get") {
      if (!objects.has(args[3])) return { code: 1, stdout: "", stderr: boxedError(args[3]) };
      stdout = objects.get(args[3])!.toString("utf8");
    } else if (args[2] === "put") {
      const body = readFileSync(args[args.indexOf("--file") + 1]);
      objects.set(args[3], body); writes.push({ key: args[3], body }); afterPut?.(args[3]);
    } else throw new Error(`Unexpected cf command: ${args.join(" ")}`);
    return { code: 0, stdout, stderr: "" };
  };
  const seed = (generation: string, suffix = "staged") => {
    const prefix = bootstrapGenerationPrefix(generation);
    for (const phase of ["base", "canonical"] as const) {
      const paths = phase === "base" ? ["views/meta.json", "views/lookup/repos.json", "views/lookup/orgs.json",
        "views/rank/all-time/repo/stock.json", "views/rank/all-time/org/stock.json", "views/heatmap/month/2026-05.json"]
        : ["canonical/v2/meta.json", ...["repos", "repo-monthly", "repo-weekly", "repo-recent-daily"].flatMap((family) =>
          Array.from({ length: 32 }, (_, shard) => `canonical/v2/${family}/${shard}.json`)), "canonical/v2/site-daily/2026.json"];
      const items = paths.map((path) => ({ path, body: encode({ sentinel: suffix }) }));
      for (const item of items) objects.set(`${prefix}/${item.path}`, item.body);
      objects.set(`${prefix}/manifests/${phase}.json`, encode(buildBootstrapPhaseManifest(generation, phase, items)));
    }
  };
  const bootPointer = (generation: string) => encode({ schema_ver: 1, generation, prefix: bootstrapGenerationPrefix(generation),
    previous_generation: null, published_at: "2026-09-13T06:00:00Z",
    base_manifest_sha256: sha256Bytes(objects.get(`${bootstrapGenerationPrefix(generation)}/manifests/base.json`)!),
    canonical_manifest_sha256: sha256Bytes(objects.get(`${bootstrapGenerationPrefix(generation)}/manifests/canonical.json`)!) });
  objects.set("views/latest.json", encode({ version: "refresh-frozen", run_id: "refresh-frozen", published_at: "2026-09-14T06:00:00Z", prev_version: null, schema_ver: 1 }));
  for (const path of ["meta.json", "lookup/repos.json", "lookup/orgs.json", "rank/all-time/repo/stock.json",
    "rank/all-time/org/stock.json", "entity/repo/1.json", "entity/repo/2.json"]) {
    objects.set(`${BASE}${path}`, Buffer.from('{ "sentinel": "current base" }\n'));
  }
  for (const key of RECOVERY_CANONICAL_KEYS) objects.set(key, encode({ sentinel: "current canonical" }));
  objects.set("canonical/v2/whitelist/latest.json", encode({ excluded: true }));
  const recoveryBaseKeysFile = join(workDir, "base-keys.json");
  const inventory = (hashed = false) => writeFileSync(recoveryBaseKeysFile, encode([...objects.keys()].filter((key) => key.startsWith(BASE))
    .map((key) => hashed ? { key, bytes: objects.get(key)!.length, sha256: sha256Bytes(objects.get(key)!) } : key)));
  inventory();
  seed(GEN);
  const options = { bucket: "fake-bucket", runCf, workDir, generation: GEN, recoveryGeneration: RECOVERY, recoveryBaseKeysFile, now: () => clock };
  const held = (run_id = "other-owner", fencing_token = 7) => encode({ run_id, fencing_token, status: "running", expires_at: new Date(clock + 600_000).toISOString() });
  return { objects, writes, calls, options, inventory, seed, bootPointer, held, publication: () => new RepairPublication(options),
    hook: (value: typeof hook) => { hook = value; }, afterPut: (value: typeof afterPut) => { afterPut = value; },
    listOverride: (value: typeof listOverride) => { listOverride = value; },
    fail: (value: string) => { failure = value; }, badListing: () => { badListing = true; }, advance: (ms: number) => { clock += ms; } };
}

describe("repair publication with fake cf only", () => {
  test("recovery puts retry through the shared layer with at most four cf children", async () => {
    const h = fixture(); let limited = false, active = 0, peak = 0, checks = 0;
    const key = `${bootstrapGenerationPrefix(RECOVERY)}/views/meta.json`;
    const waits: number[] = [];
    const runCf: CfRunner = async (args, child) => {
      active++; peak = Math.max(peak, active);
      try {
        await Bun.sleep(1);
        if (args[2] === "list" && args[args.indexOf("--prefix") + 1] === key) checks++;
        if (!limited && args[2] === "put" && args[3] === key) {
          limited = true; checks = 0;
          return { code: 1, stdout: "", stderr: boxedError(key, 429, false, true) };
        }
        if (limited && args[2] === "put" && args[3] === key) expect(checks).toBeGreaterThan(0);
        return await h.options.runCf(args, child);
      } finally { active--; }
    };
    const p = new RepairPublication({ ...h.options, runCf,
      retry: { sleep: async (ms) => { waits.push(ms); }, random: () => 0, log: () => {} } });
    await p.acquire(); await p.seal(); await p.release("failed");
    expect(limited).toBe(true); expect(waits).toEqual([30_000]); expect(peak).toBe(4); expect(active).toBe(0);
    expect(h.writes.filter((write) => write.key === key)).toHaveLength(1);
  });

  test("lease -> complete recovery -> pointer with recovery edge -> release; never writes views/latest", async () => {
    const h = fixture(), beforeViews = h.objects.get("views/latest.json")!;
    const result = await publishRepairGeneration(h.options);
    expect(h.writes[0].key).toBe(ACTIVE);
    expect(JSON.parse(h.writes[0].body.toString()).status).toBe("running");
    const pointerAt = h.writes.findIndex(({ key }) => key === POINTER);
    expect(pointerAt).toBeGreaterThan(2);
    expect(h.writes.slice(1, pointerAt).every(({ key }) => key.startsWith(`${bootstrapGenerationPrefix(RECOVERY)}/`))).toBe(true);
    expect(h.writes.slice(1, pointerAt).filter(({ key }) => key.includes("/manifests/")).length).toBe(2);
    expect(h.writes.at(-1)!.key).toBe(ACTIVE);
    expect(JSON.parse(h.writes.at(-1)!.body.toString()).status).toBe("published");
    const pointer = JSON.parse(h.objects.get(POINTER)!.toString());
    expect(pointer.generation).toBe(GEN); expect(pointer.previous_generation).toBe(RECOVERY);
    expect(result.pointer).toEqual(pointer);
    expect(h.objects.get("views/latest.json")).toEqual(beforeViews);
    expect(h.writes.some(({ key }) => key === "views/latest.json")).toBe(false);
    expect(h.objects.get(`${bootstrapGenerationPrefix(RECOVERY)}/views/meta.json`)).toEqual(h.objects.get(`${BASE}meta.json`));
    const verified = await verifyBootstrapGeneration({ generation: RECOVERY, store: { read: async (key: string) => h.objects.get(key) ?? null } });
    expect(verified.objectCount).toBe(40);
    expect(h.calls.some((args) => args.includes("--cursor"))).toBe(false);
    expect(h.calls.some((args) => args.includes("canonical/v2/whitelist/latest.json"))).toBe(false);
  });

  test("refuses another unexpired lease without any writes", async () => {
    const h = fixture(); h.objects.set(ACTIVE, h.held());
    await expect(publishRepairGeneration(h.options)).rejects.toThrow("active workflow");
    expect(h.writes).toEqual([]);
  });

  test("detects a contender between lease reads and immediately after its write", async () => {
    for (const phase of ["before", "after"]) {
      const h = fixture(); let reads = 0;
      h.hook((args) => { if (phase === "before" && args[2] === "list" && args[args.indexOf("--prefix") + 1] === ACTIVE && ++reads === 2) h.objects.set(ACTIVE, h.held()); });
      h.afterPut((key) => { if (phase === "after" && key === ACTIVE) h.objects.set(ACTIVE, h.held()); });
      await expect(publishRepairGeneration(h.options)).rejects.toThrow();
      expect(h.objects.has(POINTER)).toBe(false);
      expect(h.writes.every(({ key }) => key === ACTIVE)).toBe(true);
    }
  });

  test("refuses incomplete recovery even after sealing and releases as failed", async () => {
    for (const missing of ["manifests/base.json", "manifests/canonical.json", "canonical/v2/meta.json"]) {
      const h = fixture(), p = h.publication(); await p.acquire(); await sealRecoveryGeneration(p);
      h.objects.delete(`${bootstrapGenerationPrefix(RECOVERY)}/${missing}`);
      await expect(commitPointer(p)).rejects.toThrow();
      expect(h.objects.has(POINTER)).toBe(false);
      await p.release("failed");
      expect(JSON.parse(h.objects.get(ACTIVE)!.toString()).status).toBe("failed");
    }
  });

  test("rejects incomplete staged generation and marks lease failed", async () => {
    const h = fixture(); h.objects.delete(`${bootstrapGenerationPrefix(GEN)}/manifests/canonical.json`);
    await expect(publishRepairGeneration(h.options)).rejects.toThrow("required phase manifest is missing");
    expect(h.objects.has(POINTER)).toBe(false);
    expect(JSON.parse(h.objects.get(ACTIVE)!.toString()).status).toBe("failed");
  });

  test("preserves existing recovery objects and refuses differing bytes", async () => {
    const h = fixture(), key = `${bootstrapGenerationPrefix(RECOVERY)}/views/meta.json`;
    h.objects.set(key, encode({ conflicting: true }));
    await expect(publishRepairGeneration(h.options)).rejects.toThrow("differs");
    expect(h.writes.some((write) => write.key === key)).toBe(false);
    expect(h.objects.has(POINTER)).toBe(false);
  });

  test("reuses matching sealed recovery without rewriting it", async () => {
    const h = fixture(), p = h.publication(); await p.acquire(); await sealRecoveryGeneration(p);
    const count = h.writes.length;
    await sealRecoveryGeneration(p); expect(h.writes.length).toBe(count);
    await p.release("failed");
  });

  test("ignores bootstrap overlays and managed pointer versions; uses only approved sources", async () => {
    const h = fixture(), old = "bootstrap-prior-current";
    h.seed(old, "old"); h.objects.set(POINTER, h.bootPointer(old));
    h.objects.set(`bootstrap/overlays/${old}/canonical/v2/meta.json`, encode({ excluded: true }));
    const result = await publishRepairGeneration(h.options);
    expect(h.objects.get(`${bootstrapGenerationPrefix(RECOVERY)}/canonical/v2/meta.json`)).toEqual(h.objects.get("canonical/v2/meta.json"));
    expect(h.objects.get(`${bootstrapGenerationPrefix(RECOVERY)}/views/meta.json`)).toEqual(h.objects.get(`${BASE}meta.json`));
    expect(result.pointer.previous_generation).toBe(RECOVERY);
  });

  test("corrupt recovery after seal with an older pointer refuses and leaves pointer unchanged", async () => {
    for (const corrupt of ["manifests/base.json", "manifests/canonical.json", "canonical/v2/repos/31.json"]) {
      const h = fixture(), old = "bootstrap-prior-current";
      h.seed(old); const before = h.bootPointer(old); h.objects.set(POINTER, before);
      const p = h.publication(); await p.acquire(); await p.seal();
      h.objects.set(`${bootstrapGenerationPrefix(RECOVERY)}/${corrupt}`, encode({ corrupt: true }));
      await expect(commitPointer(p)).rejects.toThrow();
      expect(h.objects.get(POINTER)).toEqual(before);
      expect(h.writes.some(({ key }) => key === POINTER)).toBe(false);
      await p.release("failed");
    }
  });

  test("refuses changed source pointers before commit", async () => {
    const h = fixture(), p = h.publication(); await p.acquire(); await sealRecoveryGeneration(p);
    h.objects.set("views/latest.json", encode({ successor: true }));
    await expect(commitPointer(p)).rejects.toThrow("pointers changed");
    expect(h.objects.has(POINTER)).toBe(false); await p.release("failed");
  });

  test("ownership loss prevents commit and release from overwriting the successor", async () => {
    const h = fixture(), p = h.publication(); await p.acquire(); await sealRecoveryGeneration(p);
    const successor = h.held(); h.objects.set(ACTIVE, successor);
    await expect(commitPointer(p)).rejects.toThrow("lost or expired");
    await expect(p.release("failed")).rejects.toThrow("lost or expired");
    expect(h.objects.get(ACTIVE)).toEqual(successor); expect(h.objects.has(POINTER)).toBe(false);
  });

  test("detects ownership loss during staged verification before pointer write", async () => {
    const h = fixture(), p = h.publication(); await p.acquire(); await sealRecoveryGeneration(p);
    h.hook((args) => { if (args[2] === "get" && args[3].startsWith(`${bootstrapGenerationPrefix(GEN)}/`)) h.objects.set(ACTIVE, h.held()); });
    await expect(commitPointer(p)).rejects.toThrow("lost or expired");
    expect(h.objects.has(POINTER)).toBe(false);
    expect(JSON.parse(h.objects.get(ACTIVE)!.toString()).run_id).toBe("other-owner");
  });

  test("refuses changed recovery bytes with the same size", async () => {
    const h = fixture(), p = h.publication(); await p.acquire(); await sealRecoveryGeneration(p);
    const key = `${bootstrapGenerationPrefix(RECOVERY)}/canonical/v2/meta.json`;
    h.objects.set(key, Buffer.from(h.objects.get(key)!.toString().replace("current", "changed")));
    await expect(commitPointer(p)).rejects.toThrow("differs from its manifest");
    expect(h.objects.has(POINTER)).toBe(false); await p.release("failed");
  });

  test("renews with same owner and fencing token, refuses expired owner", async () => {
    const h = fixture(), p = h.publication(); h.objects.set(ACTIVE, encode({ run_id: "old", status: "failed", fencing_token: 4, expires_at: new Date(NOW - 1).toISOString() }));
    await p.acquire(); const first = JSON.parse(h.objects.get(ACTIVE)!.toString()); expect(first.fencing_token).toBe(5);
    h.advance(31_000); await sealRecoveryGeneration(p);
    const renewed = JSON.parse(h.objects.get(ACTIVE)!.toString());
    expect(renewed.run_id).toBe(first.run_id); expect(renewed.fencing_token).toBe(first.fencing_token);
    expect(Date.parse(renewed.expires_at)).toBeGreaterThan(Date.parse(first.expires_at));
    h.advance(601_000); await expect(commitPointer(p)).rejects.toThrow("expired");
  });

  test("fails closed on command errors, malformed listings and corrupt readback", async () => {
    for (const command of ["list", "get", "put"]) {
      const h = fixture(); h.fail(command);
      await expect(publishRepairGeneration(h.options)).rejects.toThrow("injected failure");
      expect(h.objects.has(POINTER)).toBe(false);
    }
    const h = fixture(); h.badListing(); await expect(publishRepairGeneration(h.options)).rejects.toThrow("Invalid cf object listing");
    const corrupt = fixture(); corrupt.afterPut((key) => { if (key.startsWith("bootstrap/generations/")) corrupt.objects.set(key, encode({ corrupt: true })); });
    await expect(publishRepairGeneration(corrupt.options)).rejects.toThrow("SHA-256 readback mismatch");
    expect(corrupt.objects.has(POINTER)).toBe(false);
  });

  test("idle layout without lease or either pointer seals the frozen fallback", async () => {
    const h = fixture(); h.objects.delete("views/latest.json");
    for (const key of [ACTIVE, POINTER, "views/latest.json"]) {
      expect(h.objects.has(key)).toBe(false);
      h.objects.set(`${key}.sibling`, encode({ unrelated: true }));
    }
    await publishRepairGeneration(h.options);
    expect(JSON.parse(h.objects.get(POINTER)!.toString()).previous_generation).toBe(RECOVERY);
    expect(h.objects.has(`${bootstrapGenerationPrefix(RECOVERY)}/manifests/canonical.json`)).toBe(true);
    expect(h.objects.has("views/latest.json")).toBe(false);
    expect(h.calls.some((args) => args[2] === "get" && args[3] === "views/latest.json")).toBe(false);
    const listed = new Map<string, number>();
    for (const args of h.calls) {
      if (args[2] === "list") {
        expect(args[args.indexOf("--per-page") + 1]).toBe("1000");
        const key = args[args.indexOf("--prefix") + 1];
        listed.set(key, (listed.get(key) ?? 0) + 1);
      } else if (args[2] === "get") {
        const count = listed.get(args[3]) ?? 0;
        expect(count).toBeGreaterThan(0);
        listed.set(args[3], count - 1);
      }
    }
  });

  test("missing frozen source with both pointers absent releases the lease", async () => {
    const missing = fixture(); missing.objects.delete("views/latest.json"); missing.objects.delete(`${BASE}meta.json`);
    await expect(publishRepairGeneration(missing.options)).rejects.toThrow("Required recovery source is missing or incomplete");
    expect(missing.objects.has(POINTER)).toBe(false);
    expect(JSON.parse(missing.objects.get(ACTIVE)!.toString()).status).toBe("failed");
  });

  test("refuses same generation and binary source, accepts legitimate replacement character", async () => {
    const h = fixture(); expect(() => new RepairPublication({ ...h.options, recoveryGeneration: GEN })).toThrow("must differ");
    const binary = fixture(); binary.objects.set(`${BASE}meta.json`, Buffer.from([0xff, 0xfe]));
    await expect(publishRepairGeneration(binary.options)).rejects.toThrow("JSON snapshot byte-size mismatch");
    expect(binary.objects.has(POINTER)).toBe(false);
    h.objects.set(`${BASE}meta.json`, encode({ text: "legitimate \uFFFD" }));
    h.inventory(true); await publishRepairGeneration(h.options);
    expect(h.objects.get(`${bootstrapGenerationPrefix(RECOVERY)}/views/meta.json`)).toEqual(h.objects.get(`${BASE}meta.json`));
  });
  test("exact-key lookup refuses a full page without the key and accepts a short absent page", async () => {
    const h = fixture();
    h.listOverride((key) => Array.from({ length: 1000 }, (_, i) => ({ key: `${key}.suffix-${i}`, size: 2 })));
    await expect(publishRepairGeneration(h.options)).rejects.toThrow("Ambiguous exact-key absence");
    expect(h.objects.has(POINTER)).toBe(false);
    expect(h.writes).toEqual([]);
    const short = fixture();
    // Missing source with only a prefix sibling must never be copied.
    short.objects.delete(`${BASE}meta.json`); short.objects.set(`${BASE}meta.json.extra`, encode({ sibling: true }));
    await expect(publishRepairGeneration(short.options)).rejects.toThrow("source is missing or incomplete");
    expect(short.objects.has(POINTER)).toBe(false);
    const present = fixture();
    const realKey = `${BASE}meta.json`, body = present.objects.get(realKey)!;
    present.listOverride((key) => key === realKey ? [{ key, size: body.length },
      ...Array.from({ length: 999 }, (_, i) => ({ key: `${key}.suffix-${i}`, size: 2 }))] : undefined);
    await publishRepairGeneration(present.options);
  });

  test("refuses incomplete or invalid base inventories and manifest fingerprints", async () => {
    for (const input of [[], ["views/other/meta.json"], [`${BASE}meta.json`, `${BASE}meta.json`],
      [{ key: `${BASE}meta.json`, bytes: -1, sha256: "no" }], ["canonical/v2/whitelist/latest.json"]]) {
      const h = fixture(); writeFileSync(h.options.recoveryBaseKeysFile, encode(input));
      await expect(publishRepairGeneration(h.options)).rejects.toThrow();
      expect(h.objects.has(POINTER)).toBe(false);
      expect(JSON.parse(h.objects.get(ACTIVE)!.toString()).status).toBe("failed");
    }
    const emptyOption = fixture(); emptyOption.options.recoveryBaseKeysFile = "";
    await expect(publishRepairGeneration(emptyOption.options)).rejects.toThrow("explicit complete key inventory");
    const incomplete = fixture(); writeFileSync(incomplete.options.recoveryBaseKeysFile, encode([`${BASE}meta.json`]));
    await expect(publishRepairGeneration(incomplete.options)).rejects.toThrow("Incomplete recovery base inventory");
    for (const kind of ["bytes", "sha256"]) {
      const h = fixture(); h.inventory(true);
      const input = JSON.parse(readFileSync(h.options.recoveryBaseKeysFile, "utf8"));
      input[0][kind] = kind === "bytes" ? 9999 : "0".repeat(64);
      writeFileSync(h.options.recoveryBaseKeysFile, encode(input));
      await expect(publishRepairGeneration(h.options)).rejects.toThrow("differs from inventory manifest");
      expect(h.objects.has(POINTER)).toBe(false);
    }
  });

  test("requires all 33 canonical sources, never a whitelist substitute", async () => {
    const h = fixture(); h.objects.delete("canonical/v2/repos/31.json");
    await expect(publishRepairGeneration(h.options)).rejects.toThrow("canonical/v2/repos/31.json");
    expect(h.objects.has(POINTER)).toBe(false);
    expect(h.calls.some((args) => args.includes("canonical/v2/whitelist/latest.json"))).toBe(false);
    expect(JSON.parse(h.objects.get(ACTIVE)!.toString()).status).toBe("failed");
  });

  test("rechecks sources against sealed copies and refuses mid-copy mutation", async () => {
    const h = fixture();
    h.afterPut((key) => { if (key.endsWith("/manifests/base.json")) h.objects.set(`${BASE}meta.json`, encode({ changed: true })); });
    await expect(publishRepairGeneration(h.options)).rejects.toThrow("Recovery copy differs from source");
    expect(h.objects.has(POINTER)).toBe(false);
  });

  test("resealing an incomplete target manifest cannot bypass fixed canonical layout", async () => {
    for (const path of ["canonical/v2/repos/31.json", "canonical/v2/site-daily/2026.json"]) {
      const h = fixture(), prefix = bootstrapGenerationPrefix(GEN);
      const manifestKey = `${prefix}/manifests/canonical.json`;
      const manifest = JSON.parse(h.objects.get(manifestKey)!.toString());
      const items = manifest.objects.filter((item: { path: string }) => item.path !== path)
        .map((item: { path: string }) => ({ path: item.path, body: h.objects.get(`${prefix}/${item.path}`)! }));
      h.objects.set(manifestKey, encode(buildBootstrapPhaseManifest(GEN, "canonical", items)));
      await expect(publishRepairGeneration(h.options)).rejects.toThrow("Incomplete repair canonical manifest");
      expect(h.objects.has(POINTER)).toBe(false);
    }
  });

  test("releases a still-owned lease when post-put acquisition read fails", async () => {
    const h = fixture(); let injected = false;
    h.hook((args) => {
      if (!injected && h.writes.length && args[2] === "get" && args[3] === ACTIVE) {
        injected = true; throw new Error("acquisition read failed");
      }
    });
    await expect(publishRepairGeneration(h.options)).rejects.toThrow("acquisition read failed");
    expect(h.objects.has(POINTER)).toBe(false);
    expect(JSON.parse(h.objects.get(ACTIVE)!.toString()).status).toBe("failed");
  });

  test("preserves a seal failure when release also fails", async () => {
    const h = fixture(); h.objects.delete(`${BASE}meta.json`);
    h.hook((args) => {
      if (args[2] === "put" && args[3] === ACTIVE && h.writes.length) throw new Error("release failed");
    });
    try { await publishRepairGeneration(h.options); throw new Error("must refuse"); }
    catch (error) {
      expect(error).toBeInstanceOf(RepairPublicationError);
      const failure = error as RepairPublicationError;
      expect(failure.phase).toBe("seal"); expect(failure.pointerMayHaveMoved).toBe(false);
      expect(failure.message).toContain("source is missing or incomplete");
      expect(String(failure.releaseError)).toContain("release failed");
    }
  });

  test("reports post-commit release failure separately with pointer movement", async () => {
    const h = fixture();
    h.hook((args) => {
      if (h.objects.has(POINTER) && args[2] === "put" && args[3] === ACTIVE) throw new Error("release failed");
    });
    try { await publishRepairGeneration(h.options); throw new Error("must refuse"); }
    catch (error) {
      expect(error).toBeInstanceOf(RepairPublicationError);
      expect((error as RepairPublicationError).phase).toBe("release");
      expect((error as RepairPublicationError).pointerMayHaveMoved).toBe(true);
      expect(String(error)).toContain("pointer may have moved");
    }
    expect(JSON.parse(h.objects.get(POINTER)!.toString()).generation).toBe(GEN);
  });

  test("a failed pointer readback reports uncertain commit and keeps recovery available", async () => {
    const h = fixture(); let once = false;
    h.hook((args) => {
      if (!once && h.objects.has(POINTER) && args[2] === "get" && args[3] === POINTER) {
        once = true; throw new Error("pointer readback lost");
      }
    });
    try { await publishRepairGeneration(h.options); throw new Error("must refuse"); }
    catch (error) {
      expect((error as RepairPublicationError).phase).toBe("commit");
      expect((error as RepairPublicationError).pointerMayHaveMoved).toBe(true);
    }
    expect(JSON.parse(h.objects.get(POINTER)!.toString()).previous_generation).toBe(RECOVERY);
  });

  test("renews during many exact-key operations and retries failed renewal immediately", async () => {
    const h = fixture(), p = h.publication(); await p.acquire();
    const token = JSON.parse(h.objects.get(ACTIVE)!.toString());
    h.hook((args) => { if (args[2] === "list") h.advance(10_000); });
    await p.seal();
    const renewed = JSON.parse(h.objects.get(ACTIVE)!.toString());
    expect(renewed.run_id).toBe(token.run_id); expect(renewed.fencing_token).toBe(token.fencing_token);
    expect(Date.parse(renewed.expires_at)).toBeGreaterThan(NOW + 600_000);
    await p.release("failed");
    const failed = fixture(), owner = failed.publication(); await owner.acquire(); failed.advance(31_000);
    let once = false;
    failed.hook((args) => { if (!once && args[2] === "put" && args[3] === ACTIVE) { once = true; throw new Error("renewal failed"); } });
    await expect(owner.store.read(`${BASE}meta.json`)).rejects.toThrow("renewal failed");
    await owner.store.read(`${BASE}meta.json`);
    expect(Date.parse(JSON.parse(failed.objects.get(ACTIVE)!.toString()).expires_at)).toBe(NOW + 631_000);
    await owner.release("failed");
  });

  test("boxed get errors, including 500 bodies mentioning 404, always fail hard", async () => {
    for (const key of [ACTIVE, POINTER, "views/latest.json", `${BASE}meta.json`]) {
      for (const status of [404, 500]) for (const fallback of [false, true]) for (const colour of [false, true]) {
        const h = fixture();
        if (key === ACTIVE) h.objects.set(ACTIVE, encode({ status: "failed", fencing_token: 1 }));
        if (key === POINTER) { h.seed("bootstrap-older"); h.objects.set(key, h.bootPointer("bootstrap-older")); }
        const before = h.objects.get(POINTER);
        const stderr = boxedError(key, status, fallback, colour);
        const runCf: CfRunner = (args, child) => args[2] === "get" && args[3] === key
          ? Promise.resolve({ code: 1, stdout: "", stderr }) : h.options.runCf(args, child);
        await expect(publishRepairGeneration({ ...h.options, runCf })).rejects.toThrow("cf get failed (1)");
        expect(h.objects.get(POINTER)).toEqual(before);
        expect(h.writes.some(({ key }) => key === POINTER)).toBe(false);
      }
    }
  });

  test("a key disappearing between list and get is a hard failure for every read type", async () => {
    for (const key of [ACTIVE, POINTER, "views/latest.json", `${BASE}meta.json`]) {
      const h = fixture();
      if (key === ACTIVE) h.objects.set(key, encode({ status: "failed", fencing_token: 1 }));
      if (key === POINTER) { h.seed("bootstrap-older"); h.objects.set(key, h.bootPointer("bootstrap-older")); }
      let raced = false;
      h.hook((args) => {
        if (!raced && args[2] === "get" && args[3] === key) { raced = true; h.objects.delete(key); }
      });
      await expect(publishRepairGeneration(h.options)).rejects.toThrow("cf get failed (1)");
      expect(raced).toBe(true);
      expect(h.writes.some(({ key }) => key === POINTER)).toBe(false);
      if (key === ACTIVE) expect(h.writes).toEqual([]);
      else expect(JSON.parse(h.objects.get(ACTIVE)!.toString()).status).toBe("failed");
    }
  });

  test("control reads refuse ambiguous full pages and accept exact matches on full pages", async () => {
    for (const key of [ACTIVE, POINTER, "views/latest.json"]) {
      const h = fixture();
      h.listOverride((prefix) => prefix === key
        ? Array.from({ length: 1000 }, (_, i) => ({ key: `${key}.suffix-${i}`, size: 2 })) : undefined);
      await expect(publishRepairGeneration(h.options)).rejects.toThrow(`Ambiguous exact-key absence: ${key}`);
      expect(h.calls.some((args) => args[2] === "get" && args[3] === key)).toBe(false);
      expect(h.writes.some(({ key }) => key === POINTER)).toBe(false);
    }
    const h = fixture();
    h.listOverride((key) => h.objects.has(key) && [ACTIVE, POINTER, "views/latest.json"].includes(key)
      ? [{ key, size: h.objects.get(key)!.length },
        ...Array.from({ length: 999 }, (_, i) => ({ key: `${key}.suffix-${i}`, size: 2 }))] : undefined);
    await publishRepairGeneration(h.options);
    expect(JSON.parse(h.objects.get(POINTER)!.toString()).generation).toBe(GEN);
  });

  test("size mismatches and non-JSON snapshots have distinct errors", async () => {
    const h = fixture(), key = `${BASE}meta.json`;
    h.listOverride((prefix) => prefix === key ? [{ key, size: h.objects.get(key)!.length + 1 }] : undefined);
    await expect(h.publication().store.read(key)).rejects.toThrow("JSON snapshot byte-size mismatch");
    const textKey = `${BASE}snapshot.txt`; h.objects.set(textKey, encode({ valid: "JSON body" }));
    await expect(h.publication().store.read(textKey)).rejects.toThrow("Non-JSON snapshot refused");
  });

  test("interval heartbeat renews while a non-lease cf get is still pending", async () => {
    const h = fixture(), p = h.publication(); await p.acquire();
    const before = JSON.parse(h.objects.get(ACTIVE)!.toString());
    const blocked = Promise.withResolvers<void>(), unblock = Promise.withResolvers<void>();
    const renewed = Promise.withResolvers<void>();
    const timer = spyOn(globalThis, "setInterval");
    h.hook(async (args) => {
      if (args[2] === "get" && args[3] === `${BASE}meta.json`) { blocked.resolve(); await unblock.promise; }
    });
    h.afterPut((key) => { if (key === ACTIVE) renewed.resolve(); });
    let settled = false;
    const reading = p.store.read(`${BASE}meta.json`).finally(() => { settled = true; });
    try {
      await blocked.promise; h.advance(31_000);
      const [tick, delay] = timer.mock.calls.at(-1)!;
      expect(delay).toBe(30_000);
      if (typeof tick !== "function") throw new Error("Expected interval heartbeat callback");
      tick();
      await renewed.promise;
      expect(settled).toBe(false);
      expect(timer).toHaveBeenCalledTimes(2); // Only the non-lease list and get.
      const lease = JSON.parse(h.objects.get(ACTIVE)!.toString());
      expect(lease.run_id).toBe(before.run_id); expect(lease.fencing_token).toBe(before.fencing_token);
      expect(Date.parse(lease.expires_at)).toBe(NOW + 631_000);
    } finally {
      unblock.resolve();
      try { await reading; } finally { timer.mockRestore(); }
    }
    await p.release("failed");
  });

  test("staging renews the lease during a slow upload and preserves raw runner results", async () => {
    const h = fixture(), p = h.publication(); await p.acquire(); await p.seal();
    const key = `${bootstrapGenerationPrefix(GEN)}/views/slow.json`, file = join(h.options.workDir, "slow.json");
    writeFileSync(file, encode({ slow: true }));
    const blocked = Promise.withResolvers<void>(), unblock = Promise.withResolvers<void>();
    const renewed = Promise.withResolvers<void>();
    const timer = spyOn(globalThis, "setInterval");
    h.hook(async (args) => {
      if (args[2] === "put" && args[3] === key) { blocked.resolve(); await unblock.promise; }
    });
    h.afterPut((key) => { if (key === ACTIVE) renewed.resolve(); });
    let settled = false;
    const upload = p.stageRunner(["r2", "objects", "put", key, "--bucket-name", "fake-bucket", "--file", file],
      { env: process.env }).finally(() => { settled = true; });
    try {
      await blocked.promise; h.advance(31_000);
      const [tick, delay] = timer.mock.calls.at(-1)!;
      expect(delay).toBe(30_000);
      if (typeof tick !== "function") throw new Error("Expected interval heartbeat callback");
      tick(); await renewed.promise;
      expect(settled).toBe(false);
      expect(Date.parse(JSON.parse(h.objects.get(ACTIVE)!.toString()).expires_at)).toBe(NOW + 631_000);
    } finally {
      unblock.resolve();
      try { expect((await upload).code).toBe(0); } finally { timer.mockRestore(); }
    }
    expect(h.objects.get(key)).toEqual(encode({ slow: true }));
    await expect(p.stageRunner(["r2", "objects", "get", key, "--bucket-name", "other"], { env: process.env }))
      .rejects.toThrow("escaped guarded bucket");
    await p.release("failed");
  });

});
