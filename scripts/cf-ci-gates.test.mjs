import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { hostWorker } from "../web/cloudflare.config.ts";
import { astroHostWorker } from "../astro/host-contract.ts";
import { buildVars } from "../web/host-contract.mjs";
import { assertHostContract, assertAllowedCfPreviewOrigin, assertRepositoryCfCiGates, commandPolicy, PREVIEW_CRONS_PAUSED } from "./cf-ci-gates.mjs";
const pkg = JSON.parse(readFileSync(new URL("../web/package.json", import.meta.url), "utf8"));

describe("typed host contract", () => {
  for (const mode of ["pre", "production"]) {
    test(`${mode} preserves every binding, public var and authorized trigger`, () => assert.deepEqual(assertHostContract(hostWorker(mode), mode), []));
    test(`${mode} rejects the other mode's page-cache namespace and an unpinned binding`, () => {
      for (const factory of [hostWorker, astroHostWorker]) {
        const worker = structuredClone(factory(mode));
        const host = factory === hostWorker ? "web" : "astro";
        for (const binding of [factory(mode === "pre" ? "production" : "pre").env.GSC_CACHE, { type: "kv" }]) {
          worker.env.GSC_CACHE = binding;
          assert.ok(assertHostContract(worker, mode, host).includes(`${mode}: binding GSC_CACHE`));
        }
      }
    });
    for (const mutate of [
      (w) => { w.name = "wrong"; }, (w) => { w.env.DATA.name = "wrong"; },
      (w) => { w.env.WORKER_SELF_REFERENCE.worker = "other"; }, (w) => { w.env.JOBS.name = "wrong"; },
      (w) => { w.triggers.push({ type: "scheduled", schedule: "0 4 * * SUN" }); },
      (w) => { w.triggers[0].maxRetries = 3; }, (w) => { w.env.EXTRA = { type: "d1" }; },
      (w) => { w.workersDev = !w.workersDev; }, (w) => { w.env.SITE_INDEXABLE.value = "wrong"; },
    ]) test(`${mode} rejects a host-contract mutation ${String(mutate)}`, () => {
      const worker = structuredClone(hostWorker(mode)); mutate(worker); assert.ok(assertHostContract(worker, mode).length);
    });
    for (const flag of ["WORKFLOW_COLD_START", "PREFLIGHT_RELAX_EMPTY_SHARDS", "WORKFLOW_FIXTURE"]) {
      test(`${mode} rejects first-publication and fixture flag ${flag}`, () => {
        assert.equal(Object.hasOwn(hostWorker(mode).env, flag), false);
        for (const value of ["0", "1"]) {
          const worker = structuredClone(hostWorker(mode));
          worker.env[flag] = { type: "text", value };
          assert.ok(assertHostContract(worker, mode).some((error) => error.includes(flag)));
        }
      });
    }
    test(`${mode} rejects opposite-mode and unknown read origins`, () => {
      for (const key of ["BLOB_BASE_URL", "NEXT_PUBLIC_BLOB_BASE_URL", "R2_PUBLIC_BASE_URL", "NEXT_PUBLIC_R2_PUBLIC_BASE_URL"]) {
        assert.throws(() => buildVars(mode, { [key]: mode === "pre" ? "https://data.gitstarclub.com" : "https://data-pre.gitstarclub.com" }));
        assert.throws(() => buildVars(mode, { [key]: "https://untrusted.example.com" }));
      }
      assert.equal(buildVars(mode, { BLOB_BASE_URL: "http://127.0.0.1:4075" }).STORAGE_READ_DRIVER, "blob");
    });
  }
  test("preview schedules cover daily, Sunday live and managed refresh; production stays paused", () => {
    assert.equal(PREVIEW_CRONS_PAUSED, false);
    const schedules = (worker) => worker.triggers.filter((trigger) => trigger.type === "scheduled").map((trigger) => trigger.schedule);
    assert.deepEqual(schedules(hostWorker("pre")), ["0 3 * * *", "0 4 * * SUN", "0 6 * * SUN"]);
    assert.deepEqual(schedules(hostWorker("production")), []);
  });
  test("preview rejects a missing daily, Sunday live or managed refresh schedule", () => {
    for (const schedule of ["0 3 * * *", "0 4 * * SUN", "0 6 * * SUN"]) {
      const worker = structuredClone(hostWorker("pre"));
      const index = worker.triggers.findIndex((trigger) => trigger.type === "scheduled" && trigger.schedule === schedule);
      assert.notEqual(index, -1);
      worker.triggers.splice(index, 1);
      assert.ok(assertHostContract(worker, "pre").some((error) => error.includes("schedules")));
    }
  });
  test("preview rejects Saturday, Unix Sunday and unexpected schedules", () => {
    for (const schedule of ["0 6 * * 7", "0 6 * * 0", "0 1 * * *"]) {
      const worker = structuredClone(hostWorker("pre"));
      worker.triggers[3].schedule = schedule;
      assert.ok(assertHostContract(worker, "pre").some((error) => error.includes("schedules")));
    }
  });
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

describe("Astro steady-state host contract", () => {
  for (const mode of ["pre", "production"]) {
    test(`${mode} validates the Astro entry and asset paths`, () => {
      assert.deepEqual(assertHostContract(astroHostWorker(mode), mode, "astro"), []);
    });
    test(`${mode} rejects changed resources, first-publication flags and schedules`, () => {
      const mutations = [
        (w) => { w.env.DATA.name = "wrong"; },
        (w) => { w.entrypoint = "wrong.ts"; },
        (w) => { w.assets.runWorkerFirst = ["/*"]; },
        (w) => { w.triggers.push({ type: "scheduled", schedule: "0 6 * * 7" }); },
        ...["WORKFLOW_COLD_START", "PREFLIGHT_RELAX_EMPTY_SHARDS", "WORKFLOW_FIXTURE"]
          .map((flag) => (w) => { w.env[flag] = { type: "text", value: "1" }; }),
      ];
      if (mode === "pre") for (const schedule of ["0 3 * * *", "0 4 * * SUN", "0 6 * * SUN"]) {
        mutations.push((w) => { w.triggers = w.triggers.filter((t) => t.schedule !== schedule); });
      }
      for (const mutate of mutations) {
        const worker = structuredClone(astroHostWorker(mode));
        mutate(worker);
        assert.ok(assertHostContract(worker, mode, "astro").length, String(mutate));
      }
    });
  }
});
