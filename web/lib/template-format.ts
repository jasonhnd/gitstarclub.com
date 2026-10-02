import { fmtStars, intlLocaleTag } from "@/lib/format";

export type TemplateValues = Readonly<Record<string, string | number | null | undefined>>;

/** Keep unresolved placeholders visible; zero and empty strings are valid values. */
export function formatTemplate(template: string, values: TemplateValues): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) => {
    const value = values[key];
    return value == null ? placeholder : String(value);
  });
}

export function formatSignedStars(value: number, locale: string): string {
  return `${value >= 0 ? "+" : "-"}${fmtStars(Math.abs(value), locale)}`;
}

export function formatConjunction(locale: string, values: readonly string[]): string {
  if (values.length === 0) return "";
  return new Intl.ListFormat(intlLocaleTag(locale), { type: "conjunction" }).format([...values]);
}
