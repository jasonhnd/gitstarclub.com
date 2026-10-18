import { expect, test } from "bun:test";
import { CanonicalMeta } from "@/lib/contracts";
import { provePreviewGapFold } from "../../../scripts/probe-preview-gap-fold";

const meta = CanonicalMeta.parse({
  seam_date: "2026-10-01", schema_ver: 1,
  folded_through: { month: "2026-09", week: "2026-W40" },
  generated_at: "2026-10-18T15:15:28.000Z",
});

test("serialized positive evidence remains empty after every negative control", async () => {
  const proof = await provePreviewGapFold(meta);
  const persisted = JSON.parse(JSON.stringify(proof));
  expect(persisted.outcomes.map((row: { pendingReads: string[] }) => row.pendingReads)).toEqual([[], [], []]);
  expect(persisted.negativeControls.map((row: { pendingReads: string[] }) => row.pendingReads)).toEqual([
    ["2026-09"], ["2026-09"], ["2026-09"],
  ]);
  proof.negativeControls[0].pendingReads.push("negative-only mutation");
  expect(proof.outcomes.every((row) => row.pendingReads.length === 0)).toBe(true);
  expect(proof.negativeControls[1].pendingReads).toEqual(["2026-09"]);
});

test("the rehearsal proof refuses a different seam or watermark", async () => {
  await expect(provePreviewGapFold({ ...meta, seam_date: "2026-09-01" })).rejects.toThrow();
  await expect(provePreviewGapFold({ ...meta, folded_through: { month: "2026-09", week: "2026-W39" } })).rejects.toThrow();
});
