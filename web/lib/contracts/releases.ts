import { z } from "zod";
import { Meta, NonNegativeInt, SafeText, TimestampStr } from "./common";

export const RELEASES_PATH = "views/releases.json";
export const RELEASE_RETENTION = 100;

/** Layer dates copied from the published version, without inventing missing cutoffs. */
export const ReleaseDataAsOf = Meta.pick({
  seam_date: true,
  generated_at: true,
  backfilled_at: true,
  folded_through: true,
});

export const ReleaseRecord = z.object({
  id: SafeText.refine((value) => value.length > 0, "release id is required"),
  published_at: TimestampStr,
  prev_version: SafeText.nullable(),
  tracked_repo_count: NonNegativeInt,
  skipped_repo_count: NonNegativeInt,
  data_as_of: ReleaseDataAsOf,
}).strict();
export type ReleaseRecord = z.infer<typeof ReleaseRecord>;

/** Public rolling history. Retained records are immutable and unique by run id. */
export const Releases = z.object({
  schema_ver: z.literal(1),
  releases: z.array(ReleaseRecord).max(RELEASE_RETENTION),
}).strict().refine((history) => new Set(history.releases.map((record) => record.id)).size === history.releases.length, {
  path: ["releases"],
  message: "release ids must be unique",
});
export type Releases = z.infer<typeof Releases>;
