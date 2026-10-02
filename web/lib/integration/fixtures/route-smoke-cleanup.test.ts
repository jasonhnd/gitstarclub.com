import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../../../", import.meta.url));
const runnerUrl = new URL("../route-smoke-runner.ts", import.meta.url).href;

describe("route smoke fixture cleanup", () => {
  for (const fail of [false, true]) {
    test(`restores fetch and read bases after ${fail ? "failure" : "success"}`, async () => {
      // A child keeps the runner's real app imports out of Bun's global mock registry.
      const source = `
        import { strictEqual } from "node:assert";
        const originalFetch = globalThis.fetch;
        const originalBase = process.env.BLOB_BASE_URL;
        const originalPublicBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL;
        const originalLog = console.log;
        const fail = ${fail};
        if (fail) console.log = (...args) => {
          if (String(args[0]).startsWith("route smoke OK:")) throw new Error("cleanup probe failure");
          originalLog(...args);
        };
        let failure;
        try {
          await import(${JSON.stringify(runnerUrl)});
        } catch (error) {
          failure = error;
        } finally {
          console.log = originalLog;
        }
        strictEqual(failure?.message, fail ? "cleanup probe failure" : undefined);
        strictEqual(globalThis.fetch, originalFetch, "fetch restored");
        strictEqual(process.env.BLOB_BASE_URL, originalBase, "read base restored");
        strictEqual(process.env.NEXT_PUBLIC_BLOB_BASE_URL, originalPublicBase, "public read base restored");
      `;
      const child = Bun.spawn({
        cmd: [process.execPath, "--eval", source],
        cwd: webRoot,
        env: {
          ...process.env,
          BLOB_BASE_URL: "https://cleanup-base.test",
          NEXT_PUBLIC_BLOB_BASE_URL: "https://cleanup-public-base.test",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(exitCode, [stdout, stderr].filter(Boolean).join("\n")).toBe(0);
    }, 30_000);
  }
});
