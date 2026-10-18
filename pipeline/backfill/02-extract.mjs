// Render pipeline/backfill/02-extract.sql. This process does not call BigQuery.
//
//   node backfill/02-extract.mjs --cutoff-suffix 260531 --destination gitstarclub.star_daily_gross_260531 > rendered.sql
//   bq query --use_legacy_sql=false --dry_run --maximum_bytes_billed=400000000000 < rendered.sql
import { readFileSync } from "node:fs";
import { renderExtractSql } from "../lib/extract-sql.mjs";

const HELP = `Render the BigQuery extract template. Does not query BigQuery.

  node backfill/02-extract.mjs --cutoff-suffix YYMMDD --destination gitstarclub.star_daily_gross_YYMMDD > rendered.sql

Gap-only, refusing an existing destination:
  node backfill/02-extract.mjs --start-suffix 260530 --cutoff-suffix 260930 --destination gitstarclub.star_daily_gross_gap_260530_260930_20261019 --create-only > gap.sql

--start-suffix defaults to 150101. --create-only emits CREATE TABLE without replacement.

Then dry-run with a byte cap:
  bq query --use_legacy_sql=false --dry_run --maximum_bytes_billed=400000000000 < rendered.sql

The unsuffixed table gitstarclub.star_daily_gross is refused.
`;

function parseArgs(argv) {
  let startSuffix;
  let cutoffSuffix;
  let destination;
  let createOnly = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--create-only") createOnly = true;
    else if (arg === "--start-suffix") {
      startSuffix = argv[++index];
      if (!startSuffix || startSuffix.startsWith("--")) throw new Error("--start-suffix requires a value");
    }
    else if (arg.startsWith("--start-suffix=")) startSuffix = arg.slice("--start-suffix=".length);
    else if (arg === "--cutoff-suffix") cutoffSuffix = argv[++index];
    else if (arg.startsWith("--cutoff-suffix=")) cutoffSuffix = arg.slice("--cutoff-suffix=".length);
    else if (arg === "--destination") destination = argv[++index];
    else if (arg.startsWith("--destination=")) destination = arg.slice("--destination=".length);
    else throw new Error(`unknown argument ${arg}`);
  }
  return { help: false, startSuffix, cutoffSuffix, destination, createOnly };
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const template = readFileSync(new URL("./02-extract.sql", import.meta.url), "utf8");
const sql = renderExtractSql(template, args);
process.stdout.write(sql.endsWith("\n") ? sql : `${sql}\n`);
