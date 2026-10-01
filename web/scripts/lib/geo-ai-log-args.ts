import { readFileSync } from "node:fs";
import type { ReportGrain } from "@/lib/geo/ai-log-report";

export type GeoAiLogFormat = "json" | "markdown";

export type GeoAiLogArgs = {
  input?: string;
  grain: ReportGrain;
  format: GeoAiLogFormat;
};

export type ParsedGeoAiLogArgs = { kind: "help"; usage: string } | { kind: "run"; args: GeoAiLogArgs };

export function geoAiLogUsage(): string {
  return [
    "Usage: bun run geo:report [--input vercel-logs.ndjson] [--grain day|week] [--format json|markdown]",
    "",
    "Reads Vercel Log Drains JSON arrays, NDJSON, or exported request-log JSON from a file or stdin.",
    "Outputs aggregate AI crawler user-agent counts and AI referrer host counts only.",
  ].join("\n");
}

export function parseGeoAiLogArgs(argv: readonly string[]): ParsedGeoAiLogArgs {
  const args: GeoAiLogArgs = { grain: "day", format: "json" };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") return { kind: "help", usage: geoAiLogUsage() };
    if (arg === "--input") {
      args.input = argv[++index];
      continue;
    }
    if (arg.startsWith("--input=")) {
      args.input = arg.slice("--input=".length);
      continue;
    }
    if (arg === "--grain") {
      args.grain = parseGrain(argv[++index]);
      continue;
    }
    if (arg.startsWith("--grain=")) {
      args.grain = parseGrain(arg.slice("--grain=".length));
      continue;
    }
    if (arg === "--format") {
      args.format = parseFormat(argv[++index]);
      continue;
    }
    if (arg.startsWith("--format=")) {
      args.format = parseFormat(arg.slice("--format=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { kind: "run", args };
}

export function readGeoAiLogFile(path: string): string {
  return readFileSync(path, "utf8");
}

function parseGrain(value: string | undefined): ReportGrain {
  if (value === "day" || value === "week") return value;
  throw new Error(`Invalid --grain value: ${value ?? ""}`);
}

function parseFormat(value: string | undefined): GeoAiLogFormat {
  if (value === "json" || value === "markdown") return value;
  throw new Error(`Invalid --format value: ${value ?? ""}`);
}
