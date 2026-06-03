import { z } from "zod";
import { Period, DateStr } from "./common";

// CompareCurve — lean projection of entity/repo/<id>.json served by /repo-curve?id= for the
// multi-repo compare page (v0.2 §5). NOT a stored Blob artifact: the route reads the versioned
// entity through the publish pointer and projects only what the overlay chart needs.
// See docs/DATA-CONTRACTS.md §2.15.

export const CompareCurve = z.object({
  id: z.number().int(),
  full_name: z.string(),
  current_stars: z.number().int(),
  /** crossed-10k day (entity.milestones.crossed_10k); null when unknown — used by the align-to-10k x-axis. */
  crossed_10k: DateStr.nullable(),
  /** [period, total_end] monthly points (entity.curve.monthly with the adds column dropped). */
  points: z.array(z.tuple([Period, z.number().int()])),
});
export type CompareCurve = z.infer<typeof CompareCurve>;
