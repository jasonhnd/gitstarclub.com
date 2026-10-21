import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openSync, closeSync } from "node:fs";
import { createServer } from "node:net";
import { startFixture, fixtureRecords } from "../../scripts/fixture";
import { startWorker } from "../../scripts/local-worker";
import { prepareWebOutput } from "../../scripts/prepare-web";
import { compareSites } from "../../scripts/compare";

const scratch = process.env.KANBAN_TMP;
if (!scratch || resolve(process.env.TMPDIR ?? "") !== resolve(scratch)) throw new Error("Set TMPDIR and KANBAN_TMP to the current card directory.");
const root = fileURLToPath(new URL("../../../", import.meta.url));
const records = fixtureRecords();
const fixture = startFixture(records);
const env = { ...process.env, BLOB_BASE_URL: fixture.url.origin };
async function run(command: string[], directory: string) {
  const child = Bun.spawn(command, { cwd: resolve(root, directory), env, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`${command.join(" ")} failed.`);
}
let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
let preview: ReturnType<typeof Bun.spawn> | undefined;
const log = openSync(resolve(scratch, "web-comparison-preview.log"), "w");
try {
  prepareWebOutput();
  await run(["bun", "run", "build:pre"], "web");
  await run(["bun", "run", "build"], "astro");
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("Could not select local preview port.");
  const port = address.port;
  await new Promise<void>((done, reject) => probe.close((error) => error ? reject(error) : done()));
  preview = Bun.spawn(["node", "node_modules/vite/bin/vite.js", "preview", "--mode", "pre", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: resolve(root, "web"), env, stdin: "ignore", stdout: log, stderr: log });
  const web = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${web}/.well-known/deployment`)).ok) { ready = true; break; } } catch { /* Wait for this process only. */ }
    if (preview.exitCode !== null) throw new Error(`Web preview exited; see ${scratch}/web-comparison-preview.log`);
    await Bun.sleep(500);
  }
  if (!ready) throw new Error("Web preview did not become ready.");
  worker = await startWorker(records, { STORAGE_READ_DRIVER: "blob", BLOB_BASE_URL: fixture.url.origin });
  const paths = JSON.parse(await Bun.file(new URL("./paths.json", import.meta.url)).text()) as string[];
  const report = await compareSites({ web, astro: (await worker.ready).origin, paths, screenshots: process.argv.includes("--screenshots") });
  const endpointResults = [];
  for (const path of paths.filter((path) => !path.endsWith("/about") && !path.endsWith("/privacy"))) {
    const responses = await Promise.all([web, (await worker.ready).origin].map((origin) => fetch(`${origin}${path}`, { headers: { "accept-language": "en" } })));
    const fields = responses.map((response) => ({ status: response.status, type: response.headers.get("content-type"), cache: response.headers.get("cache-control") }));
    const bodies = await Promise.all(responses.map((response) => response.text()));
    const head = await fetch(`${(await worker.ready).origin}${path}`, { method: "HEAD" });
    const passed = JSON.stringify(fields[0]) === JSON.stringify(fields[1]) && bodies[0] === bodies[1] && head.status === fields[1].status && await head.text() === "";
    endpointResults.push({ path, passed, web: fields[0], astro: fields[1], sameBody: bodies[0] === bodies[1], headStatus: head.status });
    console.log(`${passed ? "PASS" : "DIFF"} endpoint headers/body/HEAD ${path}`);
  }
  await Bun.write(resolve(scratch, "p6-endpoints.json"), JSON.stringify(endpointResults, null, 2) + "\n");
  process.exitCode = report.passed && endpointResults.every((result) => result.passed) ? 0 : 1;
} finally {
  if (preview) { preview.kill(); await preview.exited; }
  await worker?.dispose(); await fixture.stop(true); closeSync(log);
}
