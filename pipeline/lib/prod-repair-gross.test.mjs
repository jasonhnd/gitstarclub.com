// @ts-nocheck -- Bun test types are outside the production JS typecheck roots.
import { test, expect } from "bun:test";
import { DuckDBInstance } from "@duckdb/node-api";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRepairGrossWeeks } from "./prod-repair-gross.mjs";

test("repair archive projection sums ISO weeks and refuses invalid archive observations", async () => {
  const root = mkdtempSync(join(tmpdir(), "repair-gross-"));
  const db = await DuckDBInstance.create();
  const con = await db.connect();
  const file = join(root, "gross.parquet");
  const quoted = `'${file.replaceAll("'", "''")}'`;
  try {
    await con.run("CREATE TABLE gross(repo_id BIGINT, day DATE, gross_adds BIGINT)");
    await con.run("INSERT INTO gross VALUES (1,'2026-05-25',3),(1,'2026-05-29',5),(2,'2026-05-29',7)");
    await con.run(`COPY gross TO ${quoted} (FORMAT PARQUET)`);
    expect(await readRepairGrossWeeks([file], "2026-05-30")).toEqual([
      { id: 1, period: "2026-W22", flow: 8 }, { id: 2, period: "2026-W22", flow: 7 },
    ]);
    for (const row of ["(1,'2026-05-29',1)", "(3,'2026-05-30',1)", "(3,'2026-05-28',-1)", "(NULL,'2026-05-28',1)"]) {
      await con.run("BEGIN TRANSACTION");
      await con.run(`INSERT INTO gross VALUES ${row}`);
      await con.run(`COPY gross TO ${quoted} (FORMAT PARQUET)`);
      await expect(readRepairGrossWeeks([file], "2026-05-30")).rejects.toThrow("Invalid, duplicated, or post-seam");
      await con.run("ROLLBACK");
    }
    await expect(readRepairGrossWeeks([], "2026-05-30")).rejects.toThrow("no Parquet");
  } finally {
    con.closeSync(); db.closeSync(); rmSync(root, { recursive: true, force: true });
  }
});
