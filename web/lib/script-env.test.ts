import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  envFilePaths,
  formatEnvFileDiagnostic,
  loadEnvFiles,
  loadWebEnvFiles,
  parseEnvFile,
  warnEnvFileDiagnostic,
} from "../scripts/lib/env";

describe("script env-file parsing", () => {
  test("parses comments, blank lines, exports, quotes, and inline comments", () => {
    const parsed = parseEnvFile(
      [
        "\uFEFF# comment",
        "",
        "export BLOB_BASE_URL=https://blob.example.com/root # local note",
        "NEXT_PUBLIC_BLOB_BASE_URL='https://public.example.com/root # literal'",
        'DOUBLE="line\\nnext\\r"',
        "HASH=value#kept",
      ].join("\n"),
      "test.env",
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(Object.fromEntries(parsed.entries.map((entry) => [entry.key, entry.value]))).toEqual({
      BLOB_BASE_URL: "https://blob.example.com/root",
      NEXT_PUBLIC_BLOB_BASE_URL: "https://public.example.com/root # literal",
      DOUBLE: "line\nnext\r",
      HASH: "value#kept",
    });
  });

  test("reports malformed lines without loading them", () => {
    const parsed = parseEnvFile(["GOOD=ok", "missing-equals", "=missing-key"].join("\n"), "bad.env");

    expect(parsed.entries.map((entry) => entry.key)).toEqual(["GOOD"]);
    expect(parsed.diagnostics).toEqual([
      {
        path: "bad.env",
        line: 2,
        message: "Expected KEY=value or export KEY=value; skipping line.",
      },
      {
        path: "bad.env",
        line: 3,
        message: "Expected KEY=value or export KEY=value; skipping line.",
      },
    ]);
  });

  test("loads selected keys in file order while preserving existing environment values", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitstarclub-env-"));
    try {
      writeFileSync(
        join(dir, ".env.local"),
        [
          "BLOB_BASE_URL=https://file.example.com",
          "NEXT_PUBLIC_BLOB_BASE_URL=https://public.example.com",
          "BLOB_BASE_URL=https://later.example.com",
          "IGNORED_KEY=ignored",
        ].join("\n"),
      );

      const target: Record<string, string | undefined> = {
        NEXT_PUBLIC_BLOB_BASE_URL: "https://shell.example.com",
      };
      const result = loadWebEnvFiles(dir, {
        keys: ["BLOB_BASE_URL", "NEXT_PUBLIC_BLOB_BASE_URL"],
        target,
      });

      expect(result.loadedKeys).toEqual(["BLOB_BASE_URL"]);
      expect(target).toEqual({
        BLOB_BASE_URL: "https://file.example.com",
        NEXT_PUBLIC_BLOB_BASE_URL: "https://shell.example.com",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("supports explicit override when a caller opts in", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitstarclub-env-"));
    try {
      writeFileSync(join(dir, ".env"), "BLOB_BASE_URL=https://file.example.com\n");

      const target: Record<string, string | undefined> = {
        BLOB_BASE_URL: "https://shell.example.com",
      };
      loadEnvFiles({
        rootDir: dir,
        names: [".env"],
        keys: ["BLOB_BASE_URL"],
        target,
        override: true,
      });

      expect(target.BLOB_BASE_URL).toBe("https://file.example.com");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("formats diagnostics and warns with path and line", () => {
    const diagnostic = {
      path: "a.env",
      line: 4,
      message: "Expected KEY=value or export KEY=value; skipping line.",
    };
    expect(formatEnvFileDiagnostic(diagnostic)).toBe(
      "a.env:4: Expected KEY=value or export KEY=value; skipping line.",
    );
    const warnings: unknown[] = [];
    const original = console.warn;
    console.warn = (message?: unknown) => {
      warnings.push(message);
    };
    try {
      warnEnvFileDiagnostic(diagnostic);
    } finally {
      console.warn = original;
    }
    expect(warnings).toEqual(["a.env:4: Expected KEY=value or export KEY=value; skipping line."]);
  });

  test("skips missing files, reports diagnostics, and keeps single-quoted text literal", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitstarclub-env-"));
    try {
      expect(envFilePaths(dir, [".env.local", ".env"])).toEqual([]);
      writeFileSync(join(dir, ".env.local"), "GOOD=ok\r\nBROKEN\r\nQUOTED='line\\nnext'\r\nEMPTY=\"\"\n");
      const seen: string[] = [];
      const target: Record<string, string | undefined> = {};
      const result = loadWebEnvFiles(dir, {
        target,
        onDiagnostic: (diagnostic) => {
          seen.push(formatEnvFileDiagnostic(diagnostic));
        },
      });
      expect(result.files).toEqual([join(dir, ".env.local")]);
      expect(result.loadedKeys).toEqual(["GOOD", "QUOTED", "EMPTY"]);
      expect(target.QUOTED).toBe("line\\nnext");
      expect(target.EMPTY).toBe("");
      expect(result.diagnostics).toEqual([
        {
          path: join(dir, ".env.local"),
          line: 2,
          message: "Expected KEY=value or export KEY=value; skipping line.",
        },
      ]);
      expect(seen).toEqual([
        `${join(dir, ".env.local")}:2: Expected KEY=value or export KEY=value; skipping line.`,
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
