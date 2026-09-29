const UNSUFFIXED_TABLE = "gitstarclub.star_daily_gross";

/**
 * @param {string} template
 * @param {{ cutoffSuffix?: string, destination?: string }} [options]
 */
export function renderExtractSql(template, options = {}) {
  const { cutoffSuffix, destination } = options;
  if (typeof cutoffSuffix !== "string" || !/^\d{6}$/.test(cutoffSuffix)) {
    throw new Error("--cutoff-suffix must be a 6-digit YYMMDD value");
  }
  const table = String(destination ?? "").trim().replaceAll("`", "");
  if (!table) throw new Error("--destination is required");
  if (table === UNSUFFIXED_TABLE) {
    throw new Error(
      `refusing to overwrite ${UNSUFFIXED_TABLE}; pass a dated table such as gitstarclub.star_daily_gross_${cutoffSuffix}`,
    );
  }
  if (!/^gitstarclub\.[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new Error("--destination must look like gitstarclub.star_daily_gross_<suffix>");
  }
  if (!template.includes("@@DESTINATION_TABLE@@") || !template.includes("@@CUTOFF_SUFFIX@@")) {
    throw new Error("02-extract.sql is missing @@DESTINATION_TABLE@@ or @@CUTOFF_SUFFIX@@");
  }
  return template.replaceAll("@@DESTINATION_TABLE@@", table).replaceAll("@@CUTOFF_SUFFIX@@", cutoffSuffix);
}
