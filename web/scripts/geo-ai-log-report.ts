import { readFileSync } from "node:fs";
import { buildAiLogReport, formatAiLogReportMarkdown } from "../lib/geo/ai-log-report";
import { parseGeoAiLogArgs, readGeoAiLogFile } from "./lib/geo-ai-log-args";

const parsed = parseGeoAiLogArgs(process.argv.slice(2));
if (parsed.kind === "help") {
  console.log(parsed.usage);
  process.exit(0);
}
const args = parsed.args;
const input = args.input ? readGeoAiLogFile(args.input) : readFileSync(0, "utf8");
const report = buildAiLogReport(input, { grain: args.grain });

if (args.format === "markdown") {
  process.stdout.write(formatAiLogReportMarkdown(report));
} else {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
