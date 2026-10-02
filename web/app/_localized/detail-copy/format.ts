import { fmtStars } from "@/lib/format";
import type { CapsuleRankRow } from "@/lib/geo-capsules";
import type { Locale } from "@/lib/i18n";
import { toBcp47Locale } from "@/lib/i18n/routing";

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}

export function repoName(row: CapsuleRankRow): string {
  return `${row.owner}/${row.name}`;
}

export function rankValues(row: CapsuleRankRow, locale: Locale, opts: { period?: string; metric: "gained" | "total" }): Record<string, string> {
  return {
    repo: repoName(row),
    period: opts.period ?? "",
    value: opts.metric === "total" ? fmtStars(row.total ?? 0, locale) : signedStars(row.gained ?? 0, locale),
  };
}

function signedStars(value: number, locale: Locale): string {
  const prefix = value >= 0 ? "+" : "-";
  return `${prefix}${fmtStars(Math.abs(value), locale)}`;
}

export function listLabels(values: readonly string[], locale: Locale): string {
  const parts = new Intl.ListFormat(toBcp47Locale(locale), { type: "conjunction" }).formatToParts([...values]);
  return parts.map((part) => {
    if (part.type === "element") return part.value;
    // Preserve the existing enumeration punctuation outside the Korean fix.
    if (locale === "ja" || locale === "zh" || locale === "zh-TW") return "、";
    if (locale === "en" && part.value === ", and ") return " and ";
    if (locale === "es" && part.value === " e ") return " y ";
    return part.value;
  }).join("");
}
