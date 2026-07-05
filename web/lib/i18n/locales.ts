export const LOCALES = ["en", "ja", "zh", "zh-TW", "ko", "es", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE = "en";
export const LANG_COOKIE = "gsc_lang";

export const LANGUAGE_LABELS: Record<Locale, string> = {
  en: "English",
  ja: "日本語",
  zh: "简体中文",
  "zh-TW": "繁體中文",
  ko: "한국어",
  es: "Español",
  fr: "Français",
};

export function isLocale(s: string): s is Locale {
  return (LOCALES as readonly string[]).includes(s);
}
