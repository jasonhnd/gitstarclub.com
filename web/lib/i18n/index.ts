import en, { type Dict } from "./dictionaries/en";

export type { Dict };
export const LOCALES = ["en", "ja", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

const loaders: Record<Locale, () => Promise<Dict>> = {
  en: async () => en,
  ja: async () => (await import("./dictionaries/ja")).default,
  zh: async () => (await import("./dictionaries/zh")).default,
};

export const getDictionary = (locale: Locale): Promise<Dict> => loaders[locale]();

/** Optional catch-all [[...locale]] segment → Locale | null (null = unknown → 404). en = []. */
export function parseLocale(seg: string[] | undefined): Locale | null {
  if (!seg || seg.length === 0) return "en";
  if (seg.length === 1 && (seg[0] === "ja" || seg[0] === "zh")) return seg[0];
  return null;
}

/** URL prefix for a locale: "" for en, "/ja", "/zh". */
export const localePrefix = (locale: Locale): string => (locale === "en" ? "" : `/${locale}`);
