import { describe, test } from "bun:test";
import { join } from "node:path";

describe("route regression smoke", () => {
  test("representative public routes return 200-equivalent pages", async () => {
    const webRoot = join(import.meta.dir, "..", "..");
    const child = Bun.spawn({
      cmd: [process.execPath, "lib/integration/route-smoke-runner.ts"],
      cwd: webRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        BLOB_BASE_URL: "https://blob.test",
      },
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    if (exitCode !== 0) {
      throw new Error([`route smoke runner exited ${exitCode}`, stdout.trim(), stderr.trim()].filter(Boolean).join("\n"));
    }
  }, 30_000);
});
