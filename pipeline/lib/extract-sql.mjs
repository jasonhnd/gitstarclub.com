const UNSUFFIXED_TABLE = "gitstarclub.star_daily_gross";

/**
 * @param {string} template
 * @param {{ startSuffix?: string, cutoffSuffix?: string, destination?: string, createOnly?: boolean }} [options]
 */
export function renderExtractSql(template, options = {}) {
  const { startSuffix = "150101", cutoffSuffix, destination, createOnly = false } = options;
  if (typeof cutoffSuffix !== "string" || !/^\d{6}$/.test(cutoffSuffix)) {
    throw new Error("--cutoff-suffix must be a 6-digit YYMMDD value");
  }
  if (typeof startSuffix !== "string" || !/^\d{6}$/.test(startSuffix)) {
    throw new Error("--start-suffix must be a 6-digit YYMMDD value");
  }
  if (startSuffix < "150101" || startSuffix > cutoffSuffix) {
    throw new Error("--start-suffix must be between 150101 and --cutoff-suffix");
  }
  const table = String(destination ?? "").trim().replaceAll("`", "");
  if (!table) throw new Error("--destination is required");
  if (table === UNSUFFIXED_TABLE) {
    throw new Error(
      `refusing to overwrite ${UNSUFFIXED_TABLE}; pass a dated table such as gitstarclub.star_daily_gross_${cutoffSuffix}`,
    );
  }
  if (!/^gitstarclub\.star_daily_gross_[A-Za-z0-9_]+$/.test(table)) {
    throw new Error("--destination must look like gitstarclub.star_daily_gross_<suffix>");
  }
  for (const token of ["DESTINATION_TABLE", "START_SUFFIX", "CUTOFF_SUFFIX", "CREATE_MODE"]) {
    if (!template.includes(`@@${token}@@`)) throw new Error(`02-extract.sql is missing @@${token}@@`);
  }
  return template
    .replaceAll("@@DESTINATION_TABLE@@", table)
    .replaceAll("@@START_SUFFIX@@", startSuffix)
    .replaceAll("@@CUTOFF_SUFFIX@@", cutoffSuffix)
    .replaceAll("@@CREATE_MODE@@", createOnly ? "CREATE" : "CREATE OR REPLACE");
}
