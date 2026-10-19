// Offline evidence for the September bootstrap. Never opens the default remote I/O.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { CanonicalMeta } from "@/lib/contracts";
import { foldCanonical, type FoldDecision, type FoldIo } from "@/lib/workflows/steps/fold";

function probeIo(meta: CanonicalMeta, negative: boolean) {
  const evidence: { pendingReads: string[]; decision: FoldDecision | null } = { pendingReads: [], decision: null };
  const unexpected = async (): Promise<never> => { throw new Error("unexpected canonical mutation or shard read"); };
  const io: FoldIo = {
    readMeta: async () => structuredClone(meta),
    readPending: async (month) => {
      evidence.pendingReads.push(month);
      if (negative) return null;
      throw new Error(`unexpected pending read: ${month}`);
    },
    readMonthlyShard: unexpected, readWeeklyShard: unexpected, readSiteDaily: unexpected,
    writeMonthlyShard: unexpected, writeWeeklyShard: unexpected, writeSiteDaily: unexpected,
    writeMeta: unexpected, readMonthPlan: async () => null, readWeekPlan: async () => null,
    writeMonthPlan: unexpected, writeWeekPlan: unexpected,
    writeDecision: async (decision) => { evidence.decision = structuredClone(decision); },
  };
  return { io, evidence };
}

export async function provePreviewGapFold(meta: CanonicalMeta) {
  assert.equal(meta.seam_date, "2026-10-01");
  assert.deepEqual(meta.folded_through, { month: "2026-09", week: "2026-W40" });
  const outcomes = [];
  const negativeControls = [];
  for (const day of ["2026-10-01", "2026-10-19", "2026-10-31"]) {
    const now = new Date(`${day}T06:00:00.000Z`);
    const positive = probeIo(meta, false);
    const result = await foldCanonical("refresh-gap-positive", 1, {
      io: positive.io, now, relaxMissingFrozenPending: false,
    });
    assert.deepEqual(result, { folded: [], foldedWeeks: [] });
    assert.deepEqual(positive.evidence.pendingReads, []);
    // Persist a copy before running an entirely separate negative I/O instance.
    outcomes.push(structuredClone({ day, result, ...positive.evidence }));

    const wrong = structuredClone(meta);
    wrong.folded_through.week = "2026-W39";
    const negative = probeIo(wrong, true);
    const expectedError = "canonical/v2/pending: missing required frozen period(s) 2026-09";
    await assert.rejects(() => foldCanonical("refresh-gap-negative", 1, {
      io: negative.io, now, relaxMissingFrozenPending: false,
    }), (error: unknown) => error instanceof Error && error.message === expectedError);
    assert.deepEqual(negative.evidence.pendingReads, ["2026-09"]);
    negativeControls.push(structuredClone({ day, expectedError, ...negative.evidence }));
  }
  // Catch evidence contamination even if the individual assertions passed earlier.
  assert(outcomes.every((outcome) => outcome.pendingReads.length === 0));
  return { meta, relaxMissingFrozenPending: false, outcomes, negativeControls };
}

if (import.meta.main) {
  const [directory, output, ...extra] = process.argv.slice(2);
  assert(directory && output && extra.length === 0, "usage: bun scripts/probe-preview-gap-fold.ts CANONICAL_DIRECTORY OUTPUT_JSON");
  assert(process.env.KANBAN_TMP, "KANBAN_TMP is required");
  const destination = resolve(output);
  assert(destination.startsWith(`${resolve(process.env.KANBAN_TMP)}${sep}`), "output must be under KANBAN_TMP");
  const source = join(resolve(directory), "meta.json");
  const body = readFileSync(source);
  const proof = await provePreviewGapFold(CanonicalMeta.parse(JSON.parse(body.toString("utf8"))));
  const evidence = { source, sourceSHA256: createHash("sha256").update(body).digest("hex"), ...proof };
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, JSON.stringify(evidence, null, 2) + "\n");
  console.log(`PASS: ${proof.outcomes.length} positive cases have zero pending reads; ${proof.negativeControls.length} independent W39 controls read September and fail closed`);
}
