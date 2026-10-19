import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { hostWorker } from "../web/cloudflare.config.ts";
import { buildVars } from "../web/host-contract.mjs";
import { assertHostContract, assertAllowedCfPreviewOrigin, assertRepositoryCfCiGates, commandPolicy } from "./cf-ci-gates.mjs";
const pkg = JSON.parse(readFileSync(new URL("../web/package.json", import.meta.url), "utf8"));

describe("typed host contract", () => {
  for (const mode of ["pre", "production"]) {
    test(`${mode} preserves every binding, public var and paused trigger`, () => assert.deepEqual(assertHostContract(hostWorker(mode), mode), []));
    for (const mutate of [
      (w) => { w.name = "wrong"; }, (w) => { w.env.DATA.name = "wrong"; },
      (w) => { w.env.WORKER_SELF_REFERENCE.worker = "other"; }, (w) => { w.env.JOBS.name = "wrong"; },
      (w) => { w.triggers.push({ type: "scheduled", cron: "0 4 * * SUN" }); },
      (w) => { w.triggers[0].maxRetries = 3; }, (w) => { w.env.EXTRA = { type: "d1" }; },
      (w) => { w.workersDev = !w.workersDev; }, (w) => { w.env.SITE_INDEXABLE.value = "wrong"; },
    ]) test(`${mode} rejects a host-contract mutation ${String(mutate)}`, () => {
      const worker = structuredClone(hostWorker(mode)); mutate(worker); assert.ok(assertHostContract(worker, mode).length);
    });
    test(`${mode} rejects opposite-mode and unknown read origins`, () => {
      for (const key of ["BLOB_BASE_URL", "NEXT_PUBLIC_BLOB_BASE_URL", "R2_PUBLIC_BASE_URL", "NEXT_PUBLIC_R2_PUBLIC_BASE_URL"]) {
        assert.throws(() => buildVars(mode, { [key]: mode === "pre" ? "https://data.gitstarclub.com" : "https://data-pre.gitstarclub.com" }));
        assert.throws(() => buildVars(mode, { [key]: "https://untrusted.example.com" }));
      }
      assert.equal(buildVars(mode, { BLOB_BASE_URL: "http://127.0.0.1:4075" }).STORAGE_READ_DRIVER, "blob");
    });
  }
  test("requires an explicit mode", () => assert.throws(() => hostWorker("staging")));
  test("only public preview origins are accepted", () => {
    assert.equal(assertAllowedCfPreviewOrigin("https://pre.gitstarclub.com"), "https://pre.gitstarclub.com");
    for (const url of ["https://gitstarclub.com", "https://pre.gitstarclub.com/other", "https://pre.gitstarclub.com?x=1", "https://user@pre.gitstarclub.com"]) assert.throws(() => assertAllowedCfPreviewOrigin(url));
  });
  test("cf-only policy permits explicit local builds and owner-run pre deployment", () => assert.deepEqual(commandPolicy(pkg.scripts, ""), []));
  test("rejects platform deploys in CI and alternate/legacy package entrypoints", () => {
    for (const command of ["cf deploy", "cf queues create", "cf workers secrets put", "cf dns records create", "curl https://api.cloudflare.com/client/v4/accounts", "bunx cf deploy --env production", "vinext-cloudflare deploy --env pre", "npx wran" + "gler dev", "opennextjs-cloudflare build"]) {
      assert.ok(commandPolicy({ ...pkg.scripts, unsafe: command }, "").length);
      assert.ok(commandPolicy(pkg.scripts, command).length);
    }
  });
  test("repository configuration and required job names agree", async () => {
    await assertRepositoryCfCiGates(new URL("../", import.meta.url).pathname);
  });
});
