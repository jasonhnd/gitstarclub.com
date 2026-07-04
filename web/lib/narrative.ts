import { formatInteger } from "@/lib/format";
import type { Locale } from "@/lib/i18n";

// Deterministic monthly narrative (v0.2 §2) — a factual one-paragraph summary built from the
// month's own ranking data. No LLM / no external dependency / no stored artifact: the month page
// already loads these rows, so the blurb is composed at render time. Returns null when there is
// nothing to say. The route selects exactly one locale before rendering.

export interface NarrativeInput {
  locale: Locale;
  label: string;
  topGainers: ReadonlyArray<{ full_name: string; gained: number }>;
  fastest: ReadonlyArray<{ full_name: string; rate: number }>;
  newcomerCount: number;
  newcomers: ReadonlyArray<string>;
}

const fmt = (locale: Locale, n: number) => formatInteger(locale, n);

export type NarrativeText = string;

export function buildNarrative(i: NarrativeInput): NarrativeText | null {
  const lead = i.topGainers[0];
  if (!lead) return null; // no movers → no narrative (page renders nothing)

  const others = i.topGainers.slice(1, 3).map((r) => r.full_name);
  const locale = i.locale;
  const parts: string[] = [];
  const gained = fmt(locale, lead.gained);

  switch (locale) {
    case "ja":
      parts.push(`${i.label}は、${lead.full_name}が+${gained}スターで首位${others.length ? `となり、${joinNames(others, locale)}が続きました。` : "でした。"}`);
      break;
    case "zh":
      parts.push(`${i.label}，${lead.full_name} 以 +${gained} 星领涨${others.length ? `，${joinNames(others, locale)} 紧随其后。` : "。"}`);
      break;
    case "zh-TW":
      parts.push(`${i.label}，${lead.full_name} 以 +${gained} 星標領漲${others.length ? `，${joinNames(others, locale)} 緊隨其後。` : "。"}`);
      break;
    case "ko":
      parts.push(`${i.label}에는 ${lead.full_name}가 +${gained}개 스타로 가장 많이 늘었습니다${others.length ? `. ${joinNames(others, locale)}가 뒤를 이었습니다.` : "."}`);
      break;
    case "es":
      parts.push(`En ${i.label}, ${lead.full_name} lideró GitHub con +${gained} estrellas${others.length ? `, por delante de ${joinNames(others, locale)}.` : "."}`);
      break;
    case "fr":
      parts.push(`En ${i.label}, ${lead.full_name} a mené GitHub avec +${gained} étoiles${others.length ? `, devant ${joinNames(others, locale)}.` : "."}`);
      break;
    case "en":
      parts.push(`In ${i.label}, ${lead.full_name} led GitHub with +${gained} stars${others.length ? `, ahead of ${joinNames(others, locale)}.` : "."}`);
      break;
  }

  const fast = i.fastest[0];
  if (fast) {
    switch (locale) {
      case "ja":
        parts.push(`${fast.full_name}の成長率が最も高く、+${fast.rate}%でした。`);
        break;
      case "zh":
        parts.push(`${fast.full_name} 增速最快，+${fast.rate}%。`);
        break;
      case "zh-TW":
        parts.push(`${fast.full_name} 增速最快，+${fast.rate}%。`);
        break;
      case "ko":
        parts.push(`${fast.full_name}의 성장률이 가장 높아 +${fast.rate}%를 기록했습니다.`);
        break;
      case "es":
        parts.push(`${fast.full_name} creció más rápido, con +${fast.rate}%.`);
        break;
      case "fr":
        parts.push(`${fast.full_name} a progressé le plus vite, avec +${fast.rate} %.`);
        break;
      case "en":
        parts.push(`${fast.full_name} grew fastest, up ${fast.rate}%.`);
        break;
    }
  }

  if (i.newcomerCount > 0) {
    const sample = i.newcomers.slice(0, 2);
    const count = fmt(locale, i.newcomerCount);
    switch (locale) {
      case "ja":
        parts.push(`${count}件のリポジトリが初めて10,000スターを超えました${sample.length ? `（例: ${joinNames(sample, locale)}）。` : "。"}`);
        break;
      case "zh":
        parts.push(`${count} 个项目首次突破 1 万星${sample.length ? `（如 ${joinNames(sample, locale)}）。` : "。"}`);
        break;
      case "zh-TW":
        parts.push(`${count} 個專案首次突破 1 萬星${sample.length ? `（如 ${joinNames(sample, locale)}）。` : "。"}`);
        break;
      case "ko":
        parts.push(`${count}개 리포지토리가 처음으로 10,000 스타를 넘었습니다${sample.length ? ` (예: ${joinNames(sample, locale)}).` : "."}`);
        break;
      case "es":
        parts.push(`${count} ${i.newcomerCount === 1 ? "repositorio superó" : "repositorios superaron"} por primera vez las 10,000 estrellas${sample.length ? ` (por ejemplo, ${joinNames(sample, locale)}).` : "."}`);
        break;
      case "fr":
        parts.push(`${count} ${i.newcomerCount === 1 ? "dépôt a franchi" : "dépôts ont franchi"} pour la première fois les 10 000 étoiles${sample.length ? ` (par exemple ${joinNames(sample, locale)}).` : "."}`);
        break;
      case "en":
        parts.push(`${count} ${i.newcomerCount === 1 ? "repository" : "repositories"} first crossed 10,000 stars${sample.length ? ` (e.g. ${sample.join(", ")}).` : "."}`);
        break;
    }
  }

  return joinSentences(parts, locale);
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
