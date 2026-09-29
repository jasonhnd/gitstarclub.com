// Render pipeline/backfill/02-extract.sql. This process does not call BigQuery.
//
//   node backfill/02-extract.mjs --cutoff-suffix 260531 --destination gitstarclub.star_daily_gross_260531 > rendered.sql
//   bq query --use_legacy_sql=false --dry_run --maximum_bytes_billed=400000000000 < rendered.sql
import { readFileSync } from "node:fs";
import { renderExtractSql } from "../lib/extract-sql.mjs";

const HELP = `Render the BigQuery extract template. Does not query BigQuery.

  node backfill/02-extract.mjs --cutoff-suffix YYMMDD --destination gitstarclub.star_daily_gross_YYMMDD > rendered.sql

Then dry-run with a byte cap:
  bq query --use_legacy_sql=false --dry_run --maximum_bytes_billed=400000000000 < rendered.sql

The unsuffixed table gitstarclub.star_daily_gross is refused.
`;

function parseArgs(argv) {
  let cutoffSuffix;
  let destination;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--cutoff-suffix") cutoffSuffix = argv[++index];
    else if (arg.startsWith("--cutoff-suffix=")) cutoffSuffix = arg.slice("--cutoff-suffix=".length);
    else if (arg === "--destination") destination = argv[++index];
    else if (arg.startsWith("--destination=")) destination = arg.slice("--destination=".length);
    else throw new Error(`unknown argument ${arg}`);
  }
  return { help: false, cutoffSuffix, destination };
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const template = readFileSync(new URL("./02-extract.sql", import.meta.url), "utf8");
const sql = renderExtractSql(template, args);
process.stdout.write(sql.endsWith("\n") ? sql : `${sql}\n`);
