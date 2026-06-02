import { z } from "zod";

// Workflow checkpoint + publish-pointer contracts (Vercel Workflow, Phase 2+).
// See docs/DATA-CONTRACTS.md §2.11–2.13 and docs/VERCEL-DATA-OPERATIONS.md §7–8.

/** views/latest.json — publish pointer; the read side resolves the live version. */
export const ViewsPointer = z.object({
  version: z.string(),
  run_id: z.string(),
  published_at: z.string(),
  prev_version: z.string().nullable(),
  schema_ver: z.number().int(),
});
export type ViewsPointer = z.infer<typeof ViewsPointer>;

export const WorkflowStatus = z.enum(["running", "published", "failed"]);
export type WorkflowStatus = z.infer<typeof WorkflowStatus>;

/** ops/workflows/<run_id>/manifest.json — run metadata. */
export const WorkflowManifest = z.object({
  run_id: z.string(),
  started_at: z.string(),
  status: WorkflowStatus,
  steps: z.array(z.string()),
  published_version: z.string().nullable(),
});
export type WorkflowManifest = z.infer<typeof WorkflowManifest>;

export const StepStatus = z.enum(["running", "ok", "error"]);
export type StepStatus = z.infer<typeof StepStatus>;

/** ops/workflows/<run_id>/steps/<step>.json — per-step checkpoint. */
export const WorkflowStepCheckpoint = z.object({
  step: z.string(),
  status: StepStatus,
  started_at: z.string(),
  finished_at: z.string().nullable(),
  shards_done: z.number().int().optional(),
  files_written: z.number().int().optional(),
  error: z.string().nullable().optional(),
});
export type WorkflowStepCheckpoint = z.infer<typeof WorkflowStepCheckpoint>;

/** ops/workflows/latest-success.json — recovery point. */
export const LatestSuccess = z.object({
  run_id: z.string(),
  version: z.string(),
  published_at: z.string(),
});
export type LatestSuccess = z.infer<typeof LatestSuccess>;

/** ops/workflows/<run_id>/validation.json — publish-gate report (§2.13). */
export const WorkflowValidation = z.object({
  run_id: z.string(),
  ok: z.boolean(),
  checked: z.number().int(),
  schema_failures: z.number().int(),
  invariants: z.record(z.string(), z.union([z.boolean(), z.number()])),
  failures: z.array(z.string()),
});
export type WorkflowValidation = z.infer<typeof WorkflowValidation>;

/** One full_name change (repo_id is stable across renames). */
export const RenameEntry = z.object({
  id: z.number().int(),
  old_full_name: z.string(),
  new_full_name: z.string(),
});
export type RenameEntry = z.infer<typeof RenameEntry>;

/** ops/workflows/<run_id>/renames.json. */
export const RenameMap = z.object({
  run_id: z.string(),
  generated_at: z.string(),
  renames: z.array(RenameEntry),
});
export type RenameMap = z.infer<typeof RenameMap>;
