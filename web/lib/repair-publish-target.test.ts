import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  formatRollbackCommand, resolvePublishTarget,
  type CfRunner, type PublishTarget, type PublishTargetOptions,
} from "../scripts/repair-publish-target";

const GENERATION = "bootstrap-repair-824";
const RECOVERY = "bootstrap-recovery-824";
const buckets = { pre: "gitstarclub-data-pre", production: "gitstarclub-data-prod", rehearsal: "gitstarclub-data-rehearsal" };
function options(target: PublishTarget): PublishTargetOptions {
  return { target, bucket: buckets[target], generation: GENERATION,
    ...(target === "production" ? { confirmProduction: `publish ${GENERATION} to ${buckets.production}` }
      : target === "rehearsal" ? { confirmProduction: `rehearse ${GENERATION} in ${buckets.rehearsal}` } : {}) };
}
function fake(body: unknown, code = 0) {
  const calls: string[][] = [];
  const runner: CfRunner = async (args) => {
    calls.push([...args]);
    return { code, stdout: JSON.stringify(body), stderr: code ? "object unavailable" : "" };
  };
  return { runner, calls };
}
const identity = (target: PublishTarget) => ({ bucket: buckets[target], deploy_env: target });
const readArgs = (target: PublishTarget) => ["r2", "objects", "get", "_meta/bucket-identity.json", "--bucket-name", buckets[target], "--text"];

describe("repair publication target guards", () => {
  for (const target of ["pre", "production", "rehearsal"] as const) {
    test(`${target}: accepts only the exact bucket and identity with one read`, async () => {
      const { runner, calls } = fake(identity(target));
      expect(await resolvePublishTarget(options(target), runner)).toEqual({ target, bucket: buckets[target], generation: GENERATION });
      expect(calls).toEqual([readArgs(target)]);
    });

    for (const bucket of ["", ...Object.values(buckets).filter((bucket) => bucket !== buckets[target]), "other-pre", "other-prod", `${buckets[target]} `, buckets[target].toUpperCase()]) {
      test(`${target}: refuses bucket ${JSON.stringify(bucket)} before any cf call`, async () => {
        const { runner, calls } = fake(identity(target));
        await expect(resolvePublishTarget({ ...options(target), bucket }, runner)).rejects.toThrow(`requires bucket ${buckets[target]}`);
        expect(calls).toEqual([]);
      });
    }

    for (const marker of [null, [], "pre", {}, { bucket: buckets[target] }, { deploy_env: target }, ...(["pre", "production", "rehearsal"] as const).filter((other) => other !== target).flatMap((other) =>
      [identity(other), { bucket: buckets[target], deploy_env: other }]), { bucket: "other", deploy_env: target },
      { bucket: buckets[target], deploy_env: target === "production" ? "prod" : "PRE" }]) {
      test(`${target}: refuses invalid identity ${JSON.stringify(marker)}`, async () => {
        const { runner, calls } = fake(marker);
        await expect(resolvePublishTarget(options(target), runner)).rejects.toThrow(/identity/i);
        expect(calls).toEqual([readArgs(target)]);
      });
    }

    test(`${target}: refuses missing identity and command failures even with valid stdout`, async () => {
      for (const code of [1, 404]) {
        const { runner, calls } = fake(identity(target), code);
        await expect(resolvePublishTarget(options(target), runner)).rejects.toThrow(`cf exit ${code}`);
        expect(calls).toEqual([readArgs(target)]);
      }
    });
    test(`${target}: refuses runner rejection and empty or malformed JSON`, async () => {
      await expect(resolvePublishTarget(options(target), async () => { throw new Error("failed"); })).rejects.toThrow("Cannot read");
      for (const stdout of ["", "{", "not JSON"]) {
        await expect(resolvePublishTarget(options(target), async () => ({ code: 0, stdout, stderr: "" }))).rejects.toThrow("Invalid JSON");
      }
    });
  }

  for (const target of ["", "prod", "preview", "Production", "pre ", "unknown", "__proto__"]) {
    test(`refuses unknown target ${JSON.stringify(target)} without reading`, async () => {
      const { runner, calls } = fake(identity("pre"));
      await expect(resolvePublishTarget({ ...options("pre"), target }, runner)).rejects.toThrow("--target must be pre or production");
      expect(calls).toEqual([]);
    });
  }
  for (const confirmProduction of [undefined, "", "yes", `publish ${RECOVERY} to ${buckets.production}`, `publish ${GENERATION} to ${buckets.pre}`,
    `rehearse ${GENERATION} in ${buckets.rehearsal}`,
    `publish ${GENERATION} to ${buckets.production} `, ` publish ${GENERATION} to ${buckets.production}`, `Publish ${GENERATION} to ${buckets.production}`]) {
    test(`refuses production confirmation ${JSON.stringify(confirmProduction)} before reading`, async () => {
      const { runner, calls } = fake(identity("production"));
      await expect(resolvePublishTarget({ ...options("production"), confirmProduction }, runner)).rejects.toThrow("exact --confirm-production");
      expect(calls).toEqual([]);
    });
  }
  for (const confirmProduction of [undefined, "", "yes", `publish ${GENERATION} to ${buckets.rehearsal}`,
    `publish ${GENERATION} to ${buckets.production}`, `rehearse ${RECOVERY} in ${buckets.rehearsal}`,
    `rehearse ${GENERATION} in ${buckets.production}`, `rehearse ${GENERATION} in ${buckets.pre}`,
    `rehearse ${GENERATION} in ${buckets.rehearsal} `, ` rehearse ${GENERATION} in ${buckets.rehearsal}`,
    `Rehearse ${GENERATION} in ${buckets.rehearsal}`]) {
    test(`refuses rehearsal confirmation ${JSON.stringify(confirmProduction)} before reading`, async () => {
      const { runner, calls } = fake(identity("rehearsal"));
      await expect(resolvePublishTarget({ ...options("rehearsal"), confirmProduction }, runner)).rejects.toThrow("exact --confirm-production");
      expect(calls).toEqual([]);
    });
  }
  test("refuses production confirmation on preview", async () => {
    const { runner, calls } = fake(identity("pre"));
    await expect(resolvePublishTarget({ ...options("pre"), confirmProduction: "yes" }, runner)).rejects.toThrow("only valid with --target production");
    expect(calls).toEqual([]);
  });
  test("refuses invalid generation before reading", async () => {
    const { runner, calls } = fake(identity("pre"));
    await expect(resolvePublishTarget({ ...options("pre"), generation: "../unsafe" }, runner)).rejects.toThrow("invalid bootstrap generation");
    expect(calls).toEqual([]);
  });
  test("captures checked options before an asynchronous read", async () => {
    const input = options("production");
    const result = await resolvePublishTarget(input, async () => {
      input.target = "pre"; input.bucket = buckets.pre; input.generation = RECOVERY;
      return { code: 0, stdout: JSON.stringify(identity("production")), stderr: "" };
    });
    expect(result).toEqual({ target: "production", bucket: buckets.production, generation: GENERATION });
  });
  test("an uncaught guard refusal exits nonzero without a real cf process", () => {
    const modulePath = resolve(import.meta.dir, "../scripts/repair-publish-target.ts");
    const result = Bun.spawnSync([process.execPath, "--no-env-file", "--eval",
      `import { resolvePublishTarget } from ${JSON.stringify(modulePath)}; await resolvePublishTarget({ target: 'unknown' }, async () => { throw new Error('runner must not run'); });`],
    { env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR }, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("--target must be pre or production");
    expect(result.stderr.toString()).not.toContain("runner must not run\n");
  });
});

describe("recovery pointer command for later CLI integration", () => {
  for (const target of ["pre", "production", "rehearsal"] as const) {
    test(`formats the exact ${target} command`, () => {
      expect(formatRollbackCommand(target, RECOVERY)).toBe(
        `bun --no-env-file web/scripts/repair-publish.ts --target ${target} --bucket ${buckets[target]} --rollback ${RECOVERY}`
        + (target === "production" ? ` --confirm-production "publish ${RECOVERY} to ${buckets.production}"`
          : target === "rehearsal" ? ` --confirm-production "rehearse ${RECOVERY} in ${buckets.rehearsal}"` : ""));
    });
  }
  for (const generation of ["", "legacy-flat", "../unsafe", "bootstrap-valid;echo unsafe", "bootstrap-$(id)", "bootstrap-id\nnext"]) {
    test(`refuses unsafe recovery generation ${JSON.stringify(generation)}`, () => {
      expect(() => formatRollbackCommand("pre", generation)).toThrow("invalid bootstrap generation");
    });
  }
  test("refuses unknown rollback target at runtime", () => {
    expect(() => formatRollbackCommand("prod" as PublishTarget, RECOVERY)).toThrow("--target must be pre or production");
  });
});
