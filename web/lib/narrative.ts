import { LOCALES, type Locale } from "@/lib/i18n";

// Deterministic monthly narrative (v0.2 §2) — a factual one-paragraph summary built from the
// month's own ranking data. No LLM / no external dependency / no stored artifact: the month page
// already loads these rows, so the blurb is composed at render time. Returns null when there is
// nothing to say. Every supported locale gets an explicit deterministic template.

export interface NarrativeInput {
  labels: Record<Locale, string>;
  topGainers: ReadonlyArray<{ full_name: string; gained: number }>;
  fastest: ReadonlyArray<{ full_name: string; rate: number }>;
  newcomerCount: number;
  newcomers: ReadonlyArray<string>;
}

const fmt = (n: number) => n.toLocaleString("en-US");

export type NarrativeTexts = Record<Locale, string>;

export function buildNarrative(i: NarrativeInput): NarrativeTexts | null {
  const lead = i.topGainers[0];
  if (!lead) return null; // no movers → no narrative (page renders nothing)

  const others = i.topGainers.slice(1, 3).map((r) => r.full_name);
  const parts = LOCALES.reduce(
    (acc, locale) => {
      acc[locale] = [];
      return acc;
    },
    {} as Record<Locale, string[]>,
  );

  const gained = fmt(lead.gained);
  parts.en.push(`In ${i.labels.en}, ${lead.full_name} led GitHub with +${gained} stars${others.length ? `, ahead of ${joinNames(others, "en")}.` : "."}`);
  parts.ja.push(`${i.labels.ja}は、${lead.full_name}が+${gained}スターで首位${others.length ? `となり、${joinNames(others, "ja")}が続きました。` : "でした。"}`);
  parts.zh.push(`${i.labels.zh}，${lead.full_name} 以 +${gained} 星领涨${others.length ? `，${joinNames(others, "zh")} 紧随其后。` : "。"}`);
  parts["zh-TW"].push(`${i.labels["zh-TW"]}，${lead.full_name} 以 +${gained} 星標領漲${others.length ? `，${joinNames(others, "zh-TW")} 緊隨其後。` : "。"}`);
  parts.ko.push(`${i.labels.ko}에는 ${lead.full_name}가 +${gained}개 스타로 가장 많이 늘었습니다${others.length ? `. ${joinNames(others, "ko")}가 뒤를 이었습니다.` : "."}`);
  parts.es.push(`En ${i.labels.es}, ${lead.full_name} lideró GitHub con +${gained} estrellas${others.length ? `, por delante de ${joinNames(others, "es")}.` : "."}`);
  parts.fr.push(`En ${i.labels.fr}, ${lead.full_name} a mené GitHub avec +${gained} étoiles${others.length ? `, devant ${joinNames(others, "fr")}.` : "."}`);

  const fast = i.fastest[0];
  if (fast) {
    parts.en.push(`${fast.full_name} grew fastest, up ${fast.rate}%.`);
    parts.ja.push(`${fast.full_name}の成長率が最も高く、+${fast.rate}%でした。`);
    parts.zh.push(`${fast.full_name} 增速最快，+${fast.rate}%。`);
    parts["zh-TW"].push(`${fast.full_name} 增速最快，+${fast.rate}%。`);
    parts.ko.push(`${fast.full_name}의 성장률이 가장 높아 +${fast.rate}%를 기록했습니다.`);
    parts.es.push(`${fast.full_name} creció más rápido, con +${fast.rate}%.`);
    parts.fr.push(`${fast.full_name} a progressé le plus vite, avec +${fast.rate} %.`);
  }

  if (i.newcomerCount > 0) {
    const sample = i.newcomers.slice(0, 2);
    const count = fmt(i.newcomerCount);
    parts.en.push(`${count} ${i.newcomerCount === 1 ? "repository" : "repositories"} first crossed 10,000 stars${sample.length ? ` (e.g. ${sample.join(", ")}).` : "."}`);
    parts.ja.push(`${count}件のリポジトリが初めて10,000スターを超えました${sample.length ? `（例: ${joinNames(sample, "ja")}）。` : "。"}`);
    parts.zh.push(`${count} 个项目首次突破 1 万星${sample.length ? `（如 ${joinNames(sample, "zh")}）。` : "。"}`);
    parts["zh-TW"].push(`${count} 個專案首次突破 1 萬星${sample.length ? `（如 ${joinNames(sample, "zh-TW")}）。` : "。"}`);
    parts.ko.push(`${count}개 리포지토리가 처음으로 10,000 스타를 넘었습니다${sample.length ? ` (예: ${joinNames(sample, "ko")}).` : "."}`);
    parts.es.push(`${count} ${i.newcomerCount === 1 ? "repositorio superó" : "repositorios superaron"} por primera vez las 10,000 estrellas${sample.length ? ` (por ejemplo, ${joinNames(sample, "es")}).` : "."}`);
    parts.fr.push(`${count} ${i.newcomerCount === 1 ? "dépôt a franchi" : "dépôts ont franchi"} pour la première fois les 10 000 étoiles${sample.length ? ` (par exemple ${joinNames(sample, "fr")}).` : "."}`);
  }

  return Object.fromEntries(LOCALES.map((locale) => [locale, joinSentences(parts[locale], locale)])) as NarrativeTexts;
}

function joinNames(names: readonly string[], locale: Locale): string {
  if (locale === "en") return names.join(" and ");
  if (locale === "es") return names.join(" y ");
  if (locale === "fr") return names.join(" et ");
  if (locale === "ja" || locale === "zh" || locale === "zh-TW") return names.join("、");
  return names.join(", ");
}

function joinSentences(parts: readonly string[], locale: Locale): string {
  return locale === "zh" || locale === "zh-TW" || locale === "ja" ? parts.join("") : parts.join(" ");
}
