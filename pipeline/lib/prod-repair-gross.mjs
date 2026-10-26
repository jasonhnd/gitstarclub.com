import { DuckDBInstance } from "@duckdb/node-api";

/** Read only explicitly inventoried local Parquet; never install DuckDB extensions. */
export async function readRepairGrossWeeks(files, seamDate) {
  if (!files.length) throw new Error("Gross archive has no Parquet files");
  const literal = (value) => `'${value.replaceAll("'", "''")}'`;
  const db = await DuckDBInstance.create(":memory:", {
    autoinstall_known_extensions: "false", autoload_known_extensions: "false",
  });
  const con = await db.connect();
  try {
    // This is the accepted archive projection: day AS date, gross_adds AS delta.
    await con.run(`CREATE VIEW gross AS SELECT repo_id, day AS date, gross_adds AS delta
      FROM read_parquet([${files.map(literal).join(",")}])`);
    const [stats] = (await con.runAndReadAll(`SELECT count(*) AS rows,
      count(*) FILTER (WHERE repo_id IS NULL OR repo_id<=0 OR repo_id!=trunc(repo_id)
        OR date IS NULL OR delta IS NULL OR delta<0 OR delta!=trunc(delta)
        OR date>=DATE ${literal(seamDate)}) AS invalid,
      count(*)-count(DISTINCT (repo_id,date)) AS duplicates FROM gross`)).getRowObjects();
    if (!Number(stats.rows) || Number(stats.invalid) || Number(stats.duplicates)) {
      throw new Error("Invalid, duplicated, or post-seam gross archive rows");
    }
    return (await con.runAndReadAll(`SELECT repo_id,
      strftime(date,'%G-W%V') AS period, sum(delta) AS flow
      FROM gross GROUP BY 1,2 ORDER BY 1,2`)).getRowObjects().map((row) => {
      const id = Number(row.repo_id), flow = Number(row.flow);
      if (!Number.isSafeInteger(id) || !Number.isSafeInteger(flow)) throw new Error("Unsafe gross archive integer");
      return { id, period: String(row.period), flow };
    });
  } finally {
    con.closeSync();
    db.closeSync();
  }
}
