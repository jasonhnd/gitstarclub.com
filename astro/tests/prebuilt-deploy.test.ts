import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { hostWorker } from "../../web/cloudflare.config";
import { astroHostWorker } from "../host-contract";
import { preparePrebuiltDeploy } from "../scripts/prebuilt-deploy";

test("both preview hosts reuse the existing KV namespace; production binding stays unchanged", () => {
  for (const factory of [hostWorker, astroHostWorker]) {
    assert.deepEqual(factory("pre").env.GSC_CACHE, { type: "kv", id: "4c3107414bad4a0386fedfcf96dde6e2" });
    assert.deepEqual(factory("production").env.GSC_CACHE, { type: "kv" });
  }
});

for (const mode of ["pre", "production"] as const) test(`cf receives a self-contained ${mode} copy through cwd, preserving reviewed output and disabling provisioning`, () => {
  assert(process.env.KANBAN_TMP, "Set card-local KANBAN_TMP");
  const scratch = mkdtempSync(resolve(process.env.KANBAN_TMP, "prebuilt-deploy-test-"));
  try {
    const source = resolve(scratch, "astro-cloudflare");
    const worker = "output/v0/workers/default";
    mkdirSync(resolve(source, worker, "bundle"), { recursive: true });
    const config = JSON.stringify(astroHostWorker(mode));
    writeFileSync(resolve(source, worker, "worker.config.json"), config);
    writeFileSync(resolve(source, worker, "bundle/entry.mjs"), "export default {};");
    mkdirSync(resolve(scratch, "astro"));
    symlinkSync(source, resolve(scratch, "astro/.cloudflare"), "dir");
    mkdirSync(resolve(scratch, "linked-assets"));
    writeFileSync(resolve(scratch, "linked-assets/index.html"), "reviewed page");
    symlinkSync(resolve(scratch, "linked-assets"), resolve(source, worker, "assets"), "dir");

    const cli = resolve("node_modules/cf/bin/cf");
    const deployment = mode === "pre" ? preparePrebuiltDeploy(scratch, cli) : preparePrebuiltDeploy(scratch, cli, mode);
    expect(deployment.cmd).toEqual(["node", cli, "deploy", "--prebuilt", "--mode", mode, "--no-provision"]);
    expect(deployment.cwd.startsWith(`${scratch}/astro-deploy-`)).toBe(true);
    function assertNoSymlinks(path: string) {
      const stat = lstatSync(path);
      expect(stat.isSymbolicLink()).toBe(false);
      if (stat.isDirectory()) for (const name of readdirSync(path)) assertNoSymlinks(resolve(path, name));
    }
    assertNoSymlinks(deployment.cwd);
    const copied = resolve(deployment.cwd, ".cloudflare", worker);
    expect(readFileSync(resolve(copied, "worker.config.json"), "utf8")).toBe(config);
    expect(readFileSync(resolve(copied, "bundle/entry.mjs"), "utf8")).toBe("export default {};");
    expect(readFileSync(resolve(copied, "assets/index.html"), "utf8")).toBe("reviewed page");
    expect(lstatSync(resolve(scratch, "astro/.cloudflare")).isSymbolicLink()).toBe(true);
    expect(lstatSync(resolve(source, worker, "assets")).isSymbolicLink()).toBe(true);
    expect(readFileSync(resolve(source, worker, "worker.config.json"), "utf8")).toBe(config);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
