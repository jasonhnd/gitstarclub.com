import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { startWebWorker } from "./web-worker";
import { startFixture, fixtureRecords } from "../../scripts/fixture";
import { startWorker } from "../../scripts/local-worker";
import { prepareWebOutput } from "../../scripts/prepare-web";
import type { R2Bucket } from "../../../web/lib/storage/r2-binding-store";
import { LOCALES } from "../../src/lib/i18n";
import { assertAggregateImportGuards, IMPORT_GUARD_CONFIGS, IMPORT_TEST_SECRET } from "./aggregate-import";

// Run only after the exact-head fixture web pre build and Astro build.
// All operational HTTP calls below are loopback-only. Import probes read only
// synthetic DATA; they never begin, stage or commit an import.
const scratch = process.env.KANBAN_TMP;
if (!scratch || resolve(process.env.TMPDIR ?? "") !== resolve(scratch)) throw new Error("Set card-local TMPDIR=KANBAN_TMP.");
prepareWebOutput();
const root = fileURLToPath(new URL("../../", import.meta.url));
const records = fixtureRecords();
const fixture = startFixture(records);
let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
let original: Awaited<ReturnType<typeof startWebWorker>> | undefined;
const report: { scenario: string; path: string; method: string; passed: boolean; expected: unknown; actual: unknown }[] = [];
try {
  original = await startWebWorker(root, scratch, records, fixture.url.origin);
  const web = (await original.ready).origin;
  const originalBuild = readFileSync(resolve(root, "../web/dist/server/RSC_BUILD_ID"), "utf8").trim();
  const astroBuild = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim().slice(0, 32);
  worker = await startWorker(records);
  const astro = (await worker.ready).origin;
  const routes: [string, string][] = [
    ["/api/cron/daily", "GET"], ["/api/cron/weekly", "GET"], ["/api/workflows/refresh/start", "GET"],
    ["/api/workflows/refresh/step", "POST"], ["/api/workflows/refresh/revalidate", "POST"], ["/api/workflows/refresh/rollback", "POST"],
  ];
  const cases = routes.flatMap(([path, method]) => [
    [path, method], [path, "HEAD"], [path, "OPTIONS"], [path, method === "GET" ? "POST" : "GET"],
  ]);
  for (const lang of LOCALES) cases.push([`/api/lang?${new URLSearchParams({ lang, next: "/fr/rankings?period=month#top" })}`, "GET"]);
  cases.push(["/api/lang", "HEAD"], ["/api/lang", "OPTIONS"], ["/api/lang", "POST"]);
  // Wire framing/compression and HTTP-server timestamps are transport details.
  const transport = new Set(["date", "connection", "keep-alive", "transfer-encoding", "content-length", "content-encoding", "server"]);
  async function capture(origin: string, path: string, method: string) {
    const response = await fetch(new URL(path, origin), { method, redirect: "manual" });
    const identity = response.headers.get("x-vinext-build-id");
    if (identity !== (response.status === 503 ? null : origin === web ? originalBuild : astroBuild)) throw new Error("Response build identity does not match its built artifact.");
    const headers = [...response.headers].filter(([name]) => !transport.has(name)).map(([name, value]) => [name, name === "location" ? value.replace(origin, "https://comparison.invalid") : name === "x-vinext-build-id" ? "<artifact-build-id>" : value]);
    return { status: response.status, headers, body: Array.from(new Uint8Array(await response.arrayBuffer())) };
  }
  for (const scenario of ["published", "pointer-outage"]) {
    if (scenario === "pointer-outage") {
      for (const host of [original, worker]) {
        const bucket = await host.getR2Bucket("DATA") as unknown as R2Bucket;
        await bucket.put("views/latest.json", "invalid");
      }
    }
    for (const [path, method] of cases) {
      let expected: Awaited<ReturnType<typeof capture>>;
      let actual: Awaited<ReturnType<typeof capture>>;
      // Avoid a wall-clock second boundary changing the one-year Cookie expiry.
      // The final successful attempt must still match the entire header bytes.
      for (let attempt = 0; ; attempt++) {
        [expected, actual] = await Promise.all([capture(web, path, method), capture(astro, path, method)]);
        if (JSON.stringify(expected) === JSON.stringify(actual) || attempt === 2 || !path.startsWith("/api/lang")) break;
      }
      const passed = JSON.stringify(expected) === JSON.stringify(actual);
      report.push({ scenario, path, method, passed, expected, actual });
      console.log(`${passed ? "PASS" : "DIFF"} ${scenario} ${method} ${path}`);
    }
  }
  await original.dispose(); original = undefined;
  await worker.dispose(); worker = undefined;
  for (const config of IMPORT_GUARD_CONFIGS) {
    const strings = { CRON_SECRET: IMPORT_TEST_SECRET, ...config.strings };
    original = await startWebWorker(root, scratch, records, fixture.url.origin, strings);
    worker = await startWorker(records, strings);
    const expected = await assertAggregateImportGuards(original, config.enabled, config.secretConfigured);
    const actual = await assertAggregateImportGuards(worker, config.enabled, config.secretConfigured);
    for (let index = 0; index < expected.length; index++) {
      const passed = JSON.stringify(expected[index]) === JSON.stringify(actual[index]);
      const { path, method, scenario } = expected[index];
      report.push({ scenario: `aggregate-${config.name}-${scenario}`, path, method, passed, expected: expected[index], actual: actual[index] });
      console.log(`${passed ? "PASS" : "DIFF"} aggregate-${config.name}-${scenario} ${method} ${path}`);
    }
    if (actual.length !== expected.length) throw new Error("Aggregate guard case count differs");
    await original.dispose(); original = undefined;
    await worker.dispose(); worker = undefined;
  }
  writeFileSync(resolve(scratch, "p7-http-parity.json"), JSON.stringify({ passed: report.every((item) => item.passed), transportExcluded: [...transport], normalizedOrigin: true, buildIdentity: { web: originalBuild, astro: astroBuild, validatedAgainstArtifacts: true }, cases: report }, null, 2) + "\n");
  console.log(`P7 built-host comparison: ${report.filter((item) => item.passed).length}/${report.length} passed`);
  if (report.some((item) => !item.passed)) process.exitCode = 1;
} finally {
  await original?.dispose(); await worker?.dispose(); await fixture.stop(true);
}
