// Display formatting helpers (UI-only, no data dependency).

import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locales";

export function fmtK(n: number, locale: string = DEFAULT_LOCALE): string {
  return fmtStars(n, locale);
}

const LOCALE_TAG: Record<Locale, string> = {
  en: "en-US",
  ja: "ja-JP",
  zh: "zh-CN",
  "zh-TW": "zh-TW",
  ko: "ko-KR",
  es: "es-ES",
  fr: "fr-FR",
};

export function intlLocaleTag(locale: string): string {
  return LOCALE_TAG[locale as Locale] ?? locale;
}

const compactCache = new Map<string, Intl.NumberFormat>();

/** Locale-aware compact number, e.g. en `12.3k`, ja/zh `1.2万`, fr `12,3 k`. */
export function fmtStars(n: number, locale: string = DEFAULT_LOCALE): string {
  const tag = intlLocaleTag(locale);
  if (tag === "en-US") {
    const absolute = Math.abs(n);
    if (absolute >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (absolute >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  }
  let formatter = compactCache.get(tag);
  if (!formatter) {
    formatter = new Intl.NumberFormat(tag, {
      notation: "compact",
      compactDisplay: "short",
      maximumFractionDigits: 1,
    });
    compactCache.set(tag, formatter);
  }
  return formatter.format(n);
}

export function formatInteger(locale: string, value: number): string {
  return value.toLocaleString(intlLocaleTag(locale));
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function dtf(locale: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = fmtCache.get(key);
  if (!f) fmtCache.set(key, (f = new Intl.DateTimeFormat(intlLocaleTag(locale), { timeZone: "UTC", ...opts })));
  return f;
}

/** Localized month name, e.g. en "Oct"/"October", ja/zh "10月". */
export function monthLabel(locale: string, month: number, style: "long" | "short" = "short"): string {
  return dtf(locale, { month: style }).format(Date.UTC(2000, month - 1, 1));
}
/** Localized "month year", e.g. en "October 2024", ja/zh "2024年10月". */
export function monthYearLabel(locale: string, year: number, month: number): string {
  return dtf(locale, { year: "numeric", month: "long" }).format(Date.UTC(year, month - 1, 1));
}

/** Format an ISO calendar date in the active locale while keeping UTC day boundaries. */
export function dateLabel(locale: string, value: string, month: "long" | "short" = "short"): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, monthIndex - 1, day);
  const date = new Date(timestamp);
  if (
    !Number.isFinite(timestamp) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== monthIndex ||
    date.getUTCDate() !== day
  ) {
    return value;
  }
  return dtf(locale, { year: "numeric", month, day: "numeric" }).format(timestamp);
}

/** Parse 'YYYY-MM' or 'YYYY-MM-DD' → { y, m }. */
export function ymParts(period: string): { y: number; m: number } {
  const [y, m] = period.split("-").map(Number);
  return { y, m };
}
