import { readFileSync } from "node:fs";
import { buildAiLogReport, formatAiLogReportMarkdown, type ReportGrain } from "../lib/geo/ai-log-report";

type ReportFormat = "json" | "markdown";

type Args = {
  input?: string;
  grain: ReportGrain;
  format: ReportFormat;
};

function usage(): void {
  console.log(
    [
      "Usage: bun run geo:report [--input vercel-logs.ndjson] [--grain day|week] [--format json|markdown]",
      "",
      "Reads Vercel Log Drains JSON arrays, NDJSON, or exported request-log JSON from a file or stdin.",
      "Outputs aggregate AI crawler user-agent counts and AI referrer host counts only.",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): Args {
  const args: Args = { grain: "day", format: "json" };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
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

  return args;
}

function parseGrain(value: string | undefined): ReportGrain {
  if (value === "day" || value === "week") return value;
  throw new Error(`Invalid --grain value: ${value ?? ""}`);
}

function parseFormat(value: string | undefined): ReportFormat {
  if (value === "json" || value === "markdown") return value;
  throw new Error(`Invalid --format value: ${value ?? ""}`);
}

async function readInput(inputPath: string | undefined): Promise<string> {
  if (inputPath) return readFileSync(inputPath, "utf8");
  return readFileSync(0, "utf8");
}

const args = parseArgs(process.argv.slice(2));
const input = await readInput(args.input);
const report = buildAiLogReport(input, { grain: args.grain });

if (args.format === "markdown") {
  process.stdout.write(formatAiLogReportMarkdown(report));
} else {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
