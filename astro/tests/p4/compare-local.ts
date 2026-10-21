import { organizationRecords } from "./fixture";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openSync, closeSync } from "node:fs";
import { createServer } from "node:net";
import { startFixture } from "../../scripts/fixture";
import { startWorker } from "../../scripts/local-worker";
import { prepareWebOutput } from "../../scripts/prepare-web";
import { compareSites } from "../../scripts/compare";

const scratch = process.env.KANBAN_TMP;
if (!scratch || resolve(process.env.TMPDIR ?? "") !== resolve(scratch)) throw new Error("Set TMPDIR and KANBAN_TMP to the current card directory.");
const root = fileURLToPath(new URL("../../../", import.meta.url));
const records = organizationRecords();
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
  worker = await startWorker(records);
  const origin = (await worker.ready).origin;
  for (const prefix of ["", "/ja", "/zh", "/zh-TW", "/ko", "/es", "/fr"]) {
    for (const [path, expected] of [["/o/page/1", 308], ["/o/page/0", 404], ["/o/page/01", 404], ["/o/page/3", 404], ["/o/missing", 404], ["/o/-bad", 404], ["/o/fixture-001", 200]] as const) {
      const response = await fetch(`${origin}${prefix}${path}`, { redirect: "manual" });
      if (response.status !== expected) throw new Error(`${prefix}${path}: expected ${expected}, got ${response.status}`);
      if (expected === 308 && new URL(response.headers.get("location")!, origin).pathname !== `${prefix}/o`) throw new Error("Incorrect page-one redirect");
      await response.text();
    }
  }
  const directoryHtml = await (await fetch(`${origin}/o`)).text();
  const detailHtml = await (await fetch(`${origin}/o/example`)).text();
  if ((directoryHtml.match(/<astro-island\b/g) ?? []).length !== 2) throw new Error("Directory should hydrate only shared search/theme controls");
  if ((detailHtml.match(/<astro-island\b/g) ?? []).length !== 4) throw new Error("Detail should hydrate only search/theme/share/snippet controls");
  console.log("PASS 49 Worker route/redirect/error cases and bounded island counts");
  const paths = JSON.parse(await Bun.file(new URL("./paths.json", import.meta.url)).text()) as string[];
  const report = await compareSites({ web, astro: (await worker.ready).origin, paths, screenshots: process.argv.includes("--screenshots") });
  process.exitCode = report.passed ? 0 : 1;
} finally {
  if (preview) { preview.kill(); await preview.exited; }
  await worker?.dispose(); await fixture.stop(true); closeSync(log);
}
