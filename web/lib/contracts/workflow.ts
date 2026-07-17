import { z } from "zod";
import { NonNegativeInt, SafeText, TimestampStr } from "./common";

// Workflow checkpoint + publish-pointer contracts (Vercel Workflow, Phase 2+).
// See docs/DATA-CONTRACTS.md §2.11–2.13 and docs/VERCEL-DATA-OPERATIONS.md §7–8.

/** views/latest.json — publish pointer; the read side resolves the live version. */
export const ViewsPointer = z.object({
  version: SafeText,
  run_id: SafeText,
  published_at: TimestampStr,
  prev_version: SafeText.nullable(),
  schema_ver: NonNegativeInt,
}).strict();
export type ViewsPointer = z.infer<typeof ViewsPointer>;

export const WorkflowStatus = z.enum(["running", "published", "failed"]);
export type WorkflowStatus = z.infer<typeof WorkflowStatus>;

/** ops/workflows/<run_id>/manifest.json — run metadata. */
export const WorkflowManifest = z.object({
  run_id: SafeText,
  started_at: TimestampStr,
  status: WorkflowStatus,
  steps: z.array(SafeText),
  published_version: SafeText.nullable(),
}).strict();
export type WorkflowManifest = z.infer<typeof WorkflowManifest>;

export const WorkflowLease = z.object({
  run_id: SafeText,
  status: WorkflowStatus,
  acquired_at: TimestampStr,
  expires_at: TimestampStr,
  idempotency_key: SafeText.optional(),
  trigger: SafeText.optional(),
}).strict();
export type WorkflowLease = z.infer<typeof WorkflowLease>;

export const StepStatus = z.enum(["running", "ok", "error"]);
export type StepStatus = z.infer<typeof StepStatus>;

/** ops/workflows/<run_id>/steps/<step>.json — per-step checkpoint. */
export const WorkflowStepCheckpoint = z.object({
  step: SafeText,
  status: StepStatus,
  started_at: TimestampStr,
  finished_at: TimestampStr.nullable(),
  shards_done: NonNegativeInt.optional(),
  files_written: NonNegativeInt.optional(),
  error: SafeText.nullable().optional(),
}).strict();
export type WorkflowStepCheckpoint = z.infer<typeof WorkflowStepCheckpoint>;

/** ops/workflows/latest-success.json — recovery point. */
export const LatestSuccess = z.object({
  run_id: SafeText,
  version: SafeText,
  published_at: TimestampStr,
}).strict();
export type LatestSuccess = z.infer<typeof LatestSuccess>;

/** ops/workflows/<run_id>/validation.json — publish-gate report (§2.13). */
export const WorkflowValidation = z.object({
  run_id: SafeText,
  ok: z.boolean(),
  checked: NonNegativeInt,
  schema_failures: NonNegativeInt,
  invariants: z.record(z.string(), z.union([z.boolean(), z.number()])),
  failures: z.array(SafeText),
}).strict();
export type WorkflowValidation = z.infer<typeof WorkflowValidation>;

export const CanonicalShardManifestEntry = z.object({
  path: SafeText,
  kind: SafeText,
  bucket: NonNegativeInt,
  records: NonNegativeInt,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

/** Run-scoped receipt proving every required canonical shard parsed before publication. */
export const CanonicalGenerationManifest = z.object({
  run_id: SafeText,
  generated_at: TimestampStr,
  expected_shards: NonNegativeInt,
  validated_shards: NonNegativeInt,
  total_records: NonNegativeInt,
  complete: z.boolean(),
  shards: z.array(CanonicalShardManifestEntry),
}).strict();
export type CanonicalGenerationManifest = z.infer<typeof CanonicalGenerationManifest>;

/** One full_name change (repo_id is stable across renames). */
export const RenameEntry = z.object({
  id: NonNegativeInt,
  old_full_name: SafeText,
  new_full_name: SafeText,
}).strict();
export type RenameEntry = z.infer<typeof RenameEntry>;

/** ops/workflows/<run_id>/renames.json. */
export const RenameMap = z.object({
  run_id: SafeText,
  generated_at: TimestampStr,
  renames: z.array(RenameEntry),
}).strict();
export type RenameMap = z.infer<typeof RenameMap>;
