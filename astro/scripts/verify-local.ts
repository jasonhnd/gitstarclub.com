import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixture } from "./fixture";

const root = fileURLToPath(new URL("../../", import.meta.url));
const scratch = process.env.KANBAN_TMP;
if (!scratch) throw new Error("Set KANBAN_TMP and TMPDIR to the current card directory.");
if (resolve(process.env.TMPDIR ?? "") !== resolve(scratch)) throw new Error("TMPDIR must equal KANBAN_TMP.");
if (process.versions.bun !== "1.4.2") throw new Error("Use Bun 1.4.2.");
const fixture = startFixture();
async function run(command: string[], directory: string) {
  const child = Bun.spawn(command, { cwd: resolve(root, directory), env: { ...process.env, GSC_FIXTURE_ORIGIN: fixture.url.origin }, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  const result = await child.exited;
  if (result !== 0) throw new Error(`${command.join(" ")} failed (${result}).`);
}
try {
  await run(["bun", "install", "--frozen-lockfile"], "web");
  await run(["bun", "install", "--frozen-lockfile"], "astro");
  for (const script of ["validate:graph", "typecheck", "test", "build", "test:worker"]) await run(["bun", "run", script], "astro");
} finally { await fixture.stop(true); }
