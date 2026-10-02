import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { geoAiLogUsage, parseGeoAiLogArgs, readGeoAiLogFile } from "../../scripts/lib/geo-ai-log-args";

describe("geo-ai-log-report arguments", () => {
  test("defaults to day grain and JSON", () => {
    expect(parseGeoAiLogArgs([])).toEqual({ kind: "run", args: { grain: "day", format: "json" } });
  });

  test("accepts spaced and equals forms, and prints help", () => {
    expect(parseGeoAiLogArgs(["--input", "logs.ndjson", "--grain", "week", "--format", "markdown"])).toEqual({
      kind: "run",
      args: { input: "logs.ndjson", grain: "week", format: "markdown" },
    });
    expect(parseGeoAiLogArgs(["--input=logs.ndjson", "--grain=day", "--format=json"])).toEqual({
      kind: "run",
      args: { input: "logs.ndjson", grain: "day", format: "json" },
    });
    const help = parseGeoAiLogArgs(["--help"]);
    expect(help).toEqual({ kind: "help", usage: geoAiLogUsage() });
    expect(parseGeoAiLogArgs(["-h"])).toMatchObject({ kind: "help" });
    expect(geoAiLogUsage()).toContain("bun run geo:report");
  });

  test("rejects unknown flags and invalid grain or format", () => {
    expect(() => parseGeoAiLogArgs(["--nope"])).toThrow("Unknown argument: --nope");
    expect(() => parseGeoAiLogArgs(["--grain", "month"])).toThrow("Invalid --grain value: month");
    expect(() => parseGeoAiLogArgs(["--grain"])).toThrow("Invalid --grain value: ");
    expect(() => parseGeoAiLogArgs(["--format=yaml"])).toThrow("Invalid --format value: yaml");
    expect(() => parseGeoAiLogArgs(["--format"])).toThrow("Invalid --format value: ");
    expect(() => parseGeoAiLogArgs(["--bogus", "--help"])).toThrow("Unknown argument: --bogus");
  });

  test("reads a named input file", () => {
    const dir = mkdtempSync(join(tmpdir(), "geo-log-"));
    const path = join(dir, "logs.ndjson");
    try {
      writeFileSync(path, "{}\n");
      expect(readGeoAiLogFile(path)).toBe("{}\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
