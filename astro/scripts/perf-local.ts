import { chromium } from "@playwright/test";
import { closeSync, openSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { startFixture } from "./fixture";
import { startWorker } from "./local-worker";
import { prepareWebOutput } from "./prepare-web";
import { p5Records } from "../tests/p5/fixtures";
import { budgetFailures, samplePage, summarize, type PageSample } from "./perf-metrics";

const scratch = process.env.KANBAN_TMP;
if (!scratch || resolve(process.env.TMPDIR ?? "") !== resolve(scratch)) throw new Error("Set card-local TMPDIR and KANBAN_TMP");
prepareWebOutput();
const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.some((arg, index) => index % 2 === 0 && arg !== "--runs")) throw new Error("Use perf:local [--runs N], N >= 5");
const runs = args.length ? Number(args[1]) : 5;
if (!Number.isInteger(runs) || runs < 5) throw new Error("At least five runs are required");
const root = fileURLToPath(new URL("../../", import.meta.url));
const paths = ["/", "/rankings", "/rankings/2026/7", "/react/react", "/compare", "/pulse", "/about"].flatMap((path) => [path, path === "/" ? "/ja" : `/ja${path}`]);
const records = p5Records();
const fixture = startFixture(records);
const env = { ...process.env, BLOB_BASE_URL: fixture.url.origin, GSC_FIXTURE_ORIGIN: fixture.url.origin };
async function run(command: string[], directory: string) {
  const child = Bun.spawn(command, { cwd: resolve(root, directory), env, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`${directory}: ${command.join(" ")} failed`);
}
let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
let preview: ReturnType<typeof Bun.spawn> | undefined;
let profile: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
const log = openSync(resolve(scratch, "perf-web-preview.log"), "w");
try {
  await run(["bun", "run", "build:production"], "web");
  await run(["bun", "run", "build:production"], "astro");
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("No free loopback port");
  const port = address.port;
  await new Promise<void>((done, reject) => probe.close((error) => error ? reject(error) : done()));
  preview = Bun.spawn(["node", "node_modules/vite/bin/vite.js", "preview", "--mode", "production", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: resolve(root, "web"), env, stdin: "ignore", stdout: log, stderr: log });
  const web = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${web}/.well-known/deployment`)).ok) { ready = true; break; } } catch { /* Wait for this process only. */ }
    if (preview.exitCode !== null) throw new Error("Web preview exited; see perf-web-preview.log");
    await Bun.sleep(500);
  }
  if (!ready) throw new Error("Web preview did not become ready");
  worker = await startWorker(records);
  const astro = (await worker.ready).origin;
  profile = await chromium.launchPersistentContext(resolve(scratch, "perf-browser"), { headless: true });
  const browser = profile.browser();
  if (!browser) throw new Error("No browser available");
  const results = [];
  for (const path of paths) {
    // Warm server caches equally. Browser contexts/caches remain cold for each run.
    for (const origin of [web, astro]) {
      const response = await fetch(`${origin}${path}`, { headers: { "accept-language": "en" } });
      if (response.status !== 200) throw new Error(`Warmup ${path}: HTTP ${response.status}`);
      await response.arrayBuffer();
    }
    const samples: Record<"web" | "astro", PageSample[]> = { web: [], astro: [] };
    for (let i = 0; i < runs; i++) {
      // Alternate order to reduce systematic CPU/thermal/cache bias.
      for (const host of i % 2 ? ["astro", "web"] as const : ["web", "astro"] as const) {
        samples[host].push(await samplePage(browser, host === "web" ? web : astro, path));
      }
    }
    const old = summarize(samples.web), next = summarize(samples.astro);
    const failures = budgetFailures(old, next);
    results.push({ path, web: old, astro: next, samples, failures });
    console.log(`PERF ${path}: web/Astro gzip ${old.gzip}/${next.gzip} B; FCP ${old.fcp}/${next.fcp} ms; ${failures.length ? failures.join("; ") : "PASS"}`);
  }
  const report = {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    mode: "production", browser: browser.version(), runs,
    method: "Same p5 synthetic GET/HEAD fixture; official web preview vs built Astro Worker; desktop 1440x1000; warm server, fresh browser context and disabled cache; alternate host order; local-only requests; load + font readiness + 1s settling. Unique requested JS URLs plus executable inline scripts, UTF-8 decoded bytes and per-script gzip level 9; JSON-LD/data/props excluded. Island scripts are distinct Astro component URLs; web has one monolithic hydrated root (n/a). FCP budget: max(20ms, 10% of web median) noise allowance; LCP reported. No production/network/throttling inference.",
    passed: results.every((item) => !item.failures.length), results,
  };
  const kib = (bytes: number) => (bytes / 1024).toFixed(2);
  const table = [
    "| Path | JS KiB web / Astro | gzip KiB web / Astro | Island scripts web / Astro | Script entries web / Astro | FCP median ms web / Astro | LCP median ms web / Astro | Budget |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...results.map((r) => `| \`${r.path}\` | ${kib(r.web.bytes)} / ${kib(r.astro.bytes)} | ${kib(r.web.gzip)} / ${kib(r.astro.gzip)} | n/a / ${r.astro.islandScripts ?? 0} | ${r.web.scripts.length} / ${r.astro.scripts.length} | ${r.web.fcp.toFixed(1)} / ${r.astro.fcp.toFixed(1)} | ${r.web.lcp.toFixed(1)} / ${r.astro.lcp.toFixed(1)} | ${r.failures.length ? "FAIL" : "PASS"} |`),
  ].join("\n");
  writeFileSync(resolve(scratch, "perf-local.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(resolve(scratch, "perf-local.md"), `${report.method}\n\nCommit: \`${report.commit}\`. Chromium ${report.browser}. ${runs} runs per host/page.\n\n${table}\n`);
  console.log(table);
  process.exitCode = report.passed ? 0 : 1;
} finally {
  await profile?.close();
  if (preview) { preview.kill(); await preview.exited; }
  await worker?.dispose(); await fixture.stop(true); closeSync(log);
}
