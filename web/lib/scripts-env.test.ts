import { describe, expect, test } from "bun:test";
import { parseEnvFile, loadEnvFile } from "../scripts/lib/env";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("script env-file parsing", () => {
  test("ignores comments and blank lines, parses export assignments", () => {
    const parsed = parseEnvFile(`
# comment

export BLOB_BASE_URL=https://blob.example.com
NEXT_PUBLIC_BLOB_BASE_URL='https://public.example.com'
`);

    expect(parsed.malformed).toEqual([]);
    expect(parsed.assignments.map((item) => [item.key, item.value])).toEqual([
      ["BLOB_BASE_URL", "https://blob.example.com"],
      ["NEXT_PUBLIC_BLOB_BASE_URL", "https://public.example.com"],
    ]);
  });

  test("preserves quoted comments but strips inline comments from unquoted values", () => {
    const parsed = parseEnvFile(`
QUOTED="https://blob.example.com/#frag"
UNQUOTED=https://blob.example.com/path # local comment
MULTILINE="one\\ntwo"
`);

    expect(parsed.assignments.map((item) => [item.key, item.value])).toEqual([
      ["QUOTED", "https://blob.example.com/#frag"],
      ["UNQUOTED", "https://blob.example.com/path"],
      ["MULTILINE", "one\ntwo"],
    ]);
  });

  test("reports malformed lines without throwing", () => {
    const parsed = parseEnvFile(`
NO_EQUALS
=missing-key
GOOD=value
`);

    expect(parsed.assignments.map((item) => item.key)).toEqual(["GOOD"]);
    expect(parsed.malformed).toHaveLength(2);
    expect(parsed.malformed[0].lineNumber).toBe(2);
  });

  test("preserves existing values unless overwriteExisting is set", () => {
    const dir = mkdtempSync(join(tmpdir(), "gsc-env-"));
    try {
      const envPath = join(dir, ".env.local");
      writeFileSync(envPath, "BLOB_BASE_URL=https://from-file.example.com\n", "utf8");
      const env: Record<string, string | undefined> = { BLOB_BASE_URL: "https://from-env.example.com" };

      const first = loadEnvFile({ envPath, keys: ["BLOB_BASE_URL"], env });
      expect(first.loaded).toEqual([]);
      expect(env.BLOB_BASE_URL).toBe("https://from-env.example.com");

      const second = loadEnvFile({ envPath, keys: ["BLOB_BASE_URL"], env, overwriteExisting: true });
      expect(second.loaded).toEqual(["BLOB_BASE_URL"]);
      expect(env.BLOB_BASE_URL).toBe("https://from-file.example.com");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("can treat empty strings as missing for validate-live-views compatibility", () => {
    const dir = mkdtempSync(join(tmpdir(), "gsc-env-"));
    try {
      const envPath = join(dir, ".env.local");
      writeFileSync(envPath, "BLOB_BASE_URL=https://from-file.example.com\n", "utf8");
      const env: Record<string, string | undefined> = { BLOB_BASE_URL: "" };

      loadEnvFile({ envPath, keys: ["BLOB_BASE_URL"], env });
      expect(env.BLOB_BASE_URL).toBe("");

      loadEnvFile({ envPath, keys: ["BLOB_BASE_URL"], env, treatEmptyAsMissing: true });
      expect(env.BLOB_BASE_URL).toBe("https://from-file.example.com");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
