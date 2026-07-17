import { z } from "zod";
import { DateStr, MonthPeriod, NonNegativeInt, RankItem, TimestampStr, WeekPeriod } from "./common";

// Live tail + hot snapshot, written daily by cron. See docs/DATA-CONTRACTS.md §2.8–2.9.

/** current_month.json — in-progress month, append-only by UTC day. */
export const CurrentMonth = z.object({
  month: MonthPeriod,
  updated: DateStr,
  daily_totals: z.array(z.tuple([DateStr, z.number().int()])),
  per_repo: z.record(z.string(), z.array(z.tuple([DateStr, z.number().int()]))),
  current_stars: z.record(z.string(), NonNegativeInt),
}).strict();
export type CurrentMonth = z.infer<typeof CurrentMonth>;

const TopLists = z.object({
  flow: z.array(RankItem),
  stock: z.array(RankItem),
}).strict();

/** Source-as-of timestamps for each independently derived hot-snapshot section.
 * `null` means that the section is deliberately unavailable rather than being
 * presented with a freshness claim the writer cannot prove. Optional on the
 * outer snapshot while legacy flat blobs are phased out. */
export const HotSnapshotFreshness = z.object({
  current_month: TimestampStr.nullable(),
  current_year: TimestampStr.nullable(),
  year_spine: TimestampStr.nullable(),
  on_this_day: TimestampStr.nullable(),
  all_time: TimestampStr.nullable(),
}).strict();
export type HotSnapshotFreshness = z.infer<typeof HotSnapshotFreshness>;

/** hot-snapshot.json — read by hot ISR pages (home/current periods/all-time).
 * New live generations include section-level freshness; the field remains
 * optional so the migration reader can parse the legacy flat snapshot. */
export const HotSnapshot = z.object({
  generated_at: TimestampStr,
  freshness: HotSnapshotFreshness.optional(),
  home: z.object({
    year_spine: z.array(z.tuple([z.string(), z.number().int()])),
    current_month_top: TopLists,
    on_this_day: z.array(
      z.object({ id: NonNegativeInt, crossed: z.string(), date: DateStr }).strict(),
    ),
  }).strict(),
  current_year: TopLists,
  current_month: TopLists,
  all_time: z.object({ repo: z.array(RankItem), org: z.array(RankItem) }),
}).strict();
export type HotSnapshot = z.infer<typeof HotSnapshot>;

const LiveIdentifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9._-]+$/);
const LiveIdempotencyKey = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/);

/** Lease embedded in live/latest.json. Keeping the lease and published pointer
 * in one CAS-controlled object supplies the fencing guarantee: a stale writer
 * cannot flip the generation after its lease has been replaced. */
export const LivePublicationLease = z.object({
  run_id: LiveIdentifier,
  idempotency_key: LiveIdempotencyKey,
  job: z.enum(["daily", "weekly"]),
  acquired_at: TimestampStr,
  expires_at: TimestampStr,
}).strict();
export type LivePublicationLease = z.infer<typeof LivePublicationLease>;

/** live/latest.json — the only mutable live-overlay publication object.
 * A lease acquisition changes only `lease`; `generation` continues to point at
 * the last complete immutable generation until the final fenced CAS. */
export const LiveGenerationPointer = z.object({
  schema_ver: z.literal(1),
  generation: LiveIdentifier.nullable(),
  run_id: LiveIdentifier.nullable(),
  idempotency_key: LiveIdempotencyKey.nullable(),
  job: z.enum(["daily", "weekly"]).nullable(),
  day: DateStr.nullable(),
  month: MonthPeriod.nullable(),
  week: WeekPeriod.nullable(),
  published_at: TimestampStr.nullable(),
  previous_generation: LiveIdentifier.nullable(),
  lease: LivePublicationLease.nullable(),
}).strict().superRefine((pointer, ctx) => {
  const publishedFields = [
    pointer.run_id,
    pointer.idempotency_key,
    pointer.job,
    pointer.day,
    pointer.month,
    pointer.week,
    pointer.published_at,
  ];
  if (pointer.generation === null && publishedFields.some((value) => value !== null)) {
    ctx.addIssue({ code: "custom", message: "an unpublished pointer cannot carry publication metadata" });
  }
  if (pointer.generation !== null && publishedFields.some((value) => value === null)) {
    ctx.addIssue({ code: "custom", message: "a published pointer requires complete publication metadata" });
  }
});
export type LiveGenerationPointer = z.infer<typeof LiveGenerationPointer>;

const GenerationRelativePath = z.string().min(1).max(500).refine(
  (path) => !path.startsWith("/") && !path.split("/").includes("..") && path.endsWith(".json"),
  "must be a safe relative JSON path",
);

/** live/generations/<generation>/manifest.json — immutable completeness record
 * written after every data object and before the pointer flip. */
export const LiveGenerationManifest = z.object({
  schema_ver: z.literal(1),
  generation: LiveIdentifier,
  run_id: LiveIdentifier,
  idempotency_key: LiveIdempotencyKey,
  job: z.enum(["daily", "weekly"]),
  day: DateStr,
  month: MonthPeriod,
  week: WeekPeriod,
  created_at: TimestampStr,
  previous_generation: LiveIdentifier.nullable(),
  files: z.array(GenerationRelativePath).min(1),
}).strict();
export type LiveGenerationManifest = z.infer<typeof LiveGenerationManifest>;
