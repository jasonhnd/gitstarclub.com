// Pure context + prompt builder for the monthly LLM narrative (v0.2 §2). No I/O, no AI import —
// the step (steps/narrative.ts) gathers the rank rows and calls this, so the prompt shape is unit
// tested independently of the model call.

export interface NarrativeInput {
  /** Human month label, e.g. "May 2026". */
  label: string;
  /** Top repos by stars gained that month, descending. */
  topGainers: ReadonlyArray<{ full_name: string; gained: number }>;
  /** Fastest growers by percent (min-stars floored upstream), descending. */
  fastest: ReadonlyArray<{ full_name: string; rate: number }>;
  /** Repos that first crossed 10k stars that month. */
  newcomers: ReadonlyArray<string>;
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** Build the model prompt from a month's movers. Deterministic; safe to snapshot in tests. */
export function narrativePrompt(input: NarrativeInput): string {
  const gainers = input.topGainers.slice(0, 5).map((r) => `${r.full_name} (+${fmt(r.gained)})`).join(", ");
  const fast = input.fastest.slice(0, 3).map((r) => `${r.full_name} (+${r.rate}%)`).join(", ");
  const newc = input.newcomers.slice(0, 5).join(", ");
  return [
    `Write a one-paragraph chronicle entry about GitHub open-source momentum in ${input.label}.`,
    `Top repositories by stars gained: ${gainers || "—"}.`,
    fast ? `Fastest-growing by percent: ${fast}.` : "",
    newc ? `Repositories that first crossed 10,000 stars: ${newc}.` : "",
    `Constraints: ~70 words, factual and lively, name 1–3 standout repositories and a plausible reason each moved.`,
    `No hype words, no markdown, no lists — one flowing sentence or two.`,
    `Return an English version ("en") and a Simplified Chinese version ("zh") with the same meaning.`,
  ]
    .filter(Boolean)
    .join("\n");
}
