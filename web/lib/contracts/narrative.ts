import { z } from "zod";
import { Period } from "./common";

// narrative/<period>.json — a short, auto-generated bilingual chronicle blurb for a closed month
// (Vercel AI Gateway, best-effort). Flat + durable (one generation per month, idempotent); the
// month rankings page reads it with a fallback (absent → not rendered). See docs/IMPLEMENTATION-PLAN.md
// (v0.2 §2) and docs/DATA-CONTRACTS.md §2.15.
export const Narrative = z.object({
  period: Period,
  generated_at: z.string(),
  model: z.string().optional(),
  en: z.string(),
  zh: z.string(),
});
export type Narrative = z.infer<typeof Narrative>;
