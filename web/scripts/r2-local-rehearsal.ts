// Run from web/: bun --no-env-file scripts/r2-local-rehearsal.ts
// The harness and backfill CLIs run with a new HOME and no inherited secrets.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

assert.equal(process.argv.length, 2, "the local rehearsal takes no arguments or remote target");
assert.equal(Bun.version, "1.3.14", "use the repository's pinned Bun 1.3.14");
const path = process.env.PATH ?? "/usr/bin:/bin";
const node = Bun.spawn(["node", "--version"], { env: { PATH: path }, stdout: "pipe", stderr: "pipe" });
assert.equal(await node.exited, 0, "Node must be available on PATH");
assert.equal((await new Response(node.stdout).text()).trim(), "v24.20.0", "use pinned Node v24.20.0");

const scratch = await mkdtemp(join(tmpdir(), "gsc-r2-local-rehearsal-"));
try {
  await mkdir(join(scratch, "home"));
  await mkdir(join(scratch, "tmp"));
  const child = Bun.spawn([
    process.execPath,
    "--no-env-file",
    join(import.meta.dir, "lib/r2-local-rehearsal-harness.ts"),
    scratch,
  ], {
    cwd: scratch,
    env: {
      PATH: path,
      HOME: join(scratch, "home"),
      TMPDIR: join(scratch, "tmp"),
      WRANGLER_SEND_METRICS: "false",
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  const timer = setTimeout(() => child.kill(), 120_000);
  try {
    assert.equal(await child.exited, 0, "local R2 rehearsal failed");
  } finally {
    clearTimeout(timer);
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
