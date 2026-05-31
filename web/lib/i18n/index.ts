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

export function isLocale(s: string): s is Locale {
  return (LOCALES as readonly string[]).includes(s);
}

/** Validate a `[lang]` route param → Locale | null (null = unknown → notFound). */
export const parseLang = (lang: string): Locale | null => (isLocale(lang) ? lang : null);

/** URL prefix for a locale. Every locale is prefixed in this scheme (en lives at /en). */
export const localePrefix = (locale: Locale): string => `/${locale}`;
