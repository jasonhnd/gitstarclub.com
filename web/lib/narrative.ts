// Deterministic monthly narrative (v0.2 §2) — a factual one-paragraph summary built from the
// month's own ranking data. No LLM / no external dependency / no stored artifact: the month page
// already loads these rows, so the blurb is composed at render time. Bilingual (en/zh); the
// Narrative component swaps by locale. Returns null when there is nothing to say.

export interface NarrativeInput {
  labelEn: string; // "June 2024"
  labelZh: string; // "2024 年 6 月"
  topGainers: ReadonlyArray<{ full_name: string; gained: number }>;
  fastest: ReadonlyArray<{ full_name: string; rate: number }>;
  newcomerCount: number;
  newcomers: ReadonlyArray<string>;
}

const en = (n: number) => n.toLocaleString("en-US");

export function buildNarrative(i: NarrativeInput): { en: string; zh: string } | null {
  const lead = i.topGainers[0];
  if (!lead) return null; // no movers → no narrative (page renders nothing)

  const others = i.topGainers.slice(1, 3).map((r) => r.full_name);
  const enParts: string[] = [];
  const zhParts: string[] = [];

  enParts.push(
    `In ${i.labelEn}, ${lead.full_name} led GitHub with +${en(lead.gained)} stars` +
      (others.length ? `, ahead of ${others.join(" and ")}.` : "."),
  );
  zhParts.push(
    `${i.labelZh}，${lead.full_name} 以 +${en(lead.gained)} 星领涨` +
      (others.length ? `，${others.join("、")} 紧随其后。` : "。"),
  );

  const fast = i.fastest[0];
  if (fast) {
    enParts.push(`${fast.full_name} grew fastest, up ${fast.rate}%.`);
    zhParts.push(`${fast.full_name} 增速最快，+${fast.rate}%。`);
  }

  if (i.newcomerCount > 0) {
    const sample = i.newcomers.slice(0, 2);
    enParts.push(
      `${en(i.newcomerCount)} ${i.newcomerCount === 1 ? "repository" : "repositories"} first crossed 10,000 stars` +
        (sample.length ? ` (e.g. ${sample.join(", ")}).` : "."),
    );
    zhParts.push(`${en(i.newcomerCount)} 个项目首次突破 1 万星` + (sample.length ? `（如 ${sample.join("、")}）。` : "。"));
  }

  return { en: enParts.join(" "), zh: zhParts.join("") };
}
