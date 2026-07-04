import en, { type Dict } from "./dictionaries/en";
import { type Locale } from "./locales";

export type { Dict };
export type { Locale };
export { DEFAULT_LOCALE, LANG_COOKIE, LANGUAGE_LABELS, LOCALES, isLocale } from "./locales";

const loaders: Record<Locale, () => Promise<Dict>> = {
  en: async () => en,
  ja: async () => (await import("./dictionaries/ja")).default,
  zh: async () => (await import("./dictionaries/zh")).default,
  "zh-TW": async () => (await import("./dictionaries/zh-tw")).default,
  ko: async () => (await import("./dictionaries/ko")).default,
  es: async () => (await import("./dictionaries/es")).default,
  fr: async () => (await import("./dictionaries/fr")).default,
};

export const getDictionary = (locale: Locale): Promise<Dict> => loaders[locale]();
