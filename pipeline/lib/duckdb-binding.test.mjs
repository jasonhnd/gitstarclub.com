// @ts-nocheck -- Bun's test globals are intentionally outside the production JS typecheck roots.
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { DuckDBInstance } from "@duckdb/node-api";

const require = createRequire(import.meta.url);
const installed = JSON.parse(readFileSync(require.resolve("@duckdb/node-api/package.json"), "utf8"));

/** DuckDB SQL wants forward slashes, including on Windows. */
function sqlPath(path) {
  return path.replaceAll("\\", "/");
}

describe("@duckdb/node-api offline fixture", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsc-duckdb-"));
  /** @type {import("@duckdb/node-api").DuckDBInstance | undefined} */
  let instance;
  /** @type {import("@duckdb/node-api").DuckDBConnection | undefined} */
  let connection;

  afterAll(() => {
    connection?.closeSync();
    instance?.closeSync();
    rmSync(dir, { recursive: true, force: true });
  });

  test("loads 1.5.6-r.1 and runs the backfill SQL shapes", async () => {
    expect(installed.version).toBe("1.5.6-r.1");

    const reposPath = sqlPath(join(dir, "repos.json"));
    const grossPath = sqlPath(join(dir, "gross.parquet"));
    const canonPath = sqlPath(join(dir, "star_daily.parquet"));
    writeFileSync(
      reposPath,
      JSON.stringify([
        { id: 1, owner: "acme", owner_type: "org", current_stars: 6, full_name: "acme/widget" },
        { id: 2, owner: "ada", owner_type: "user", current_stars: 9, full_name: "ada/lib" },
      ]),
    );

    instance = await DuckDBInstance.create();
    connection = await instance.connect();
    const query = async (sql) => (await connection.runAndReadAll(sql)).getRowObjects();

    const [{ version }] = await query("SELECT version() AS version");
    expect(String(version)).toContain("1.5.6");

    await connection.run(
      `COPY (
         SELECT * FROM (VALUES
           (1::BIGINT, DATE '2024-01-01', 4::BIGINT),
           (1::BIGINT, DATE '2024-01-08', 8::BIGINT),
           (2::BIGINT, DATE '2024-01-01', 3::BIGINT)
         ) t(repo_id, day, gross_adds)
       ) TO '${grossPath}' (FORMAT PARQUET)`,
    );
    await connection.run(
      `COPY (
         SELECT repo_id, day AS date, gross_adds AS delta
         FROM read_parquet('${grossPath}')
       ) TO '${canonPath}' (FORMAT PARQUET)`,
    );

    const milestones = await query(
      `WITH cum AS (
         SELECT repo_id, date,
                SUM(delta) OVER (PARTITION BY repo_id ORDER BY date) AS cumstars
         FROM read_parquet('${canonPath}')
       )
       SELECT repo_id,
         CAST(MIN(date) FILTER (WHERE cumstars >= 10) AS VARCHAR) AS crossed_10,
         CAST(MIN(date) FILTER (WHERE cumstars >= 100) AS VARCHAR) AS crossed_100
       FROM cum GROUP BY repo_id
       ORDER BY repo_id`,
    );
    expect(milestones.map((row) => [Number(row.repo_id), row.crossed_10, row.crossed_100])).toEqual([
      [1, "2024-01-08", null],
      [2, null, null],
    ]);

    await connection.run(
      `CREATE TABLE disc AS
       SELECT m.id repo_id,
              CASE WHEN COALESCE(g.tot, 0) > 0 THEN m.current_stars::DOUBLE / g.tot ELSE 1 END d
       FROM read_json_auto('${reposPath}', maximum_object_size=1000000, sample_size=-1) m
       LEFT JOIN (
         SELECT repo_id, SUM(delta) tot FROM read_parquet('${canonPath}') GROUP BY 1
       ) g ON g.repo_id = m.id`,
    );

    const [{ hi }] = await query(`SELECT CAST(MAX(date) AS VARCHAR) hi FROM read_parquet('${canonPath}')`);
    expect(String(hi)).toBe("2024-01-08");
    const [{ wk }] = await query(`SELECT strftime(DATE '${hi}', '%G-W%V') wk`);
    expect(String(wk)).toBe("2024-W02");

    const discounts = await query("SELECT repo_id, d FROM disc ORDER BY repo_id");
    expect(discounts.map((row) => [Number(row.repo_id), Number(row.d)])).toEqual([
      [1, 0.5],
      [2, 3],
    ]);

    const stock = await query(
      `WITH agg AS (
         SELECT s.repo_id, strftime(s.date, '%Y-%m') period, SUM(s.delta) flow
         FROM read_parquet('${canonPath}') s
         GROUP BY 1, 2
       ),
       cum AS (
         SELECT repo_id, period, flow,
                SUM(flow) OVER (PARTITION BY repo_id ORDER BY period) cumgross
         FROM agg
       )
       SELECT c.repo_id, c.period, c.flow,
              CAST(round(c.cumgross * d.d) AS BIGINT) stock_est,
              ROW_NUMBER() OVER (PARTITION BY c.period ORDER BY c.flow DESC, c.repo_id) flow_rank
       FROM cum c JOIN disc d ON d.repo_id = c.repo_id
       ORDER BY c.repo_id`,
    );
    expect(
      stock.map((row) => [Number(row.repo_id), String(row.period), Number(row.flow), Number(row.stock_est), Number(row.flow_rank)]),
    ).toEqual([
      [1, "2024-01", 12, 6, 1],
      [2, "2024-01", 3, 9, 2],
    ]);

    const filled = await query(
      `SELECT i, last_value(x IGNORE NULLS) OVER (ORDER BY i) filled
       FROM (VALUES (1, 10::BIGINT), (2, NULL::BIGINT)) t(i, x)
       ORDER BY i`,
    );
    expect(filled.map((row) => Number(row.filled))).toEqual([10, 10]);
  });
});
