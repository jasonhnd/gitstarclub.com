import en, { type Dict } from "./dictionaries/en";

export type { Dict };
export const LOCALES = ["en", "ja", "zh"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LANG_COOKIE = "gsc_lang";

const loaders: Record<Locale, () => Promise<Dict>> = {
  en: async () => en,
  ja: async () => (await import("./dictionaries/ja")).default,
  zh: async () => (await import("./dictionaries/zh")).default,
};

export const getDictionary = (locale: Locale): Promise<Dict> => loaders[locale]();

export function isLocale(s: string): s is Locale {
  return (LOCALES as readonly string[]).includes(s);
}
