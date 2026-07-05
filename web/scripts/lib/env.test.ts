import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFiles, loadScriptEnvFiles, scriptEnvFiles } from "./env";

describe("script env file loading", () => {
  test("discovers web/.env.local as the script env file", () => {
    withTempDir((dir) => {
      const env: Record<string, string | undefined> = {};
      const envPath = join(dir, ".env.local");
      writeFileSync(envPath, "BLOB_BASE_URL=https://blob.example\n", "utf8");

      expect(scriptEnvFiles(dir)).toEqual([envPath]);

      const result = loadScriptEnvFiles(dir, { keys: ["BLOB_BASE_URL"], env });
      expect(result.files.map((file) => file.file)).toEqual([envPath]);
      expect(env.BLOB_BASE_URL).toBe("https://blob.example");
    });
  });

  test("handles comments, blank lines, export prefixes, quoting, and inline comments", () => {
    withTempDir((dir) => {
      const env: Record<string, string | undefined> = {};
      const envPath = join(dir, ".env.local");
      writeFileSync(
        envPath,
        [
          "\uFEFF# leading comment",
          "",
          "export PLAIN = https://plain.example/base # trailing comment",
          "SINGLE='literal # not a comment'",
          'DOUBLE="line\\nnext\\r"',
          "IGNORED=unused",
        ].join("\n"),
        "utf8",
      );

      const result = loadEnvFiles({ files: [envPath], keys: ["PLAIN", "SINGLE", "DOUBLE"], env });

      expect(result.diagnostics).toEqual([]);
      expect(result.files[0].applied).toEqual(["PLAIN", "SINGLE", "DOUBLE"]);
      expect(env.PLAIN).toBe("https://plain.example/base");
      expect(env.SINGLE).toBe("literal # not a comment");
      expect(env.DOUBLE).toBe("line\nnext\r");
      expect(env.IGNORED).toBeUndefined();
    });
  });

  test("reports malformed non-comment lines and keeps loading valid lines", () => {
    withTempDir((dir) => {
      const env: Record<string, string | undefined> = {};
      const envPath = join(dir, ".env.local");
      writeFileSync(envPath, ["NO_EQUALS", "=missing-key", "GOOD=ok"].join("\n"), "utf8");

      const result = loadEnvFiles({ files: [envPath], keys: ["GOOD"], env });

      expect(env.GOOD).toBe("ok");
      expect(result.diagnostics).toEqual([
        {
          file: envPath,
          line: 1,
          source: "NO_EQUALS",
          message: "Expected KEY=VALUE.",
        },
        {
          file: envPath,
          line: 2,
          source: "=missing-key",
          message: "Expected a non-empty key before =.",
        },
      ]);
    });
  });

  test("does not override existing env values or earlier loaded files by default", () => {
    withTempDir((dir) => {
      const env: Record<string, string | undefined> = {
        PRESET: "from-env",
      };
      const first = join(dir, ".env.local");
      const second = join(dir, ".env.fallback");
      writeFileSync(first, ["PRESET=from-file", "SHARED=first"].join("\n"), "utf8");
      writeFileSync(second, ["SHARED=second", "ONLY_SECOND=second"].join("\n"), "utf8");

      const result = loadEnvFiles({ files: [first, second], keys: ["PRESET", "SHARED", "ONLY_SECOND"], env });

      expect(env.PRESET).toBe("from-env");
      expect(env.SHARED).toBe("first");
      expect(env.ONLY_SECOND).toBe("second");
      expect(result.files[0].applied).toEqual(["SHARED"]);
      expect(result.files[0].skippedExisting).toEqual(["PRESET"]);
      expect(result.files[1].applied).toEqual(["ONLY_SECOND"]);
      expect(result.files[1].skippedExisting).toEqual(["SHARED"]);
    });
  });
});

function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "script-env-"));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
