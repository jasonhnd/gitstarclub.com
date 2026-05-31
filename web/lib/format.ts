// Display formatting helpers (UI-only, no data dependency).

export function fmtK(n: number): string {
  return Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function fmtStars(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

const LOCALE_TAG: Record<string, string> = { en: "en-US", ja: "ja-JP", zh: "zh-CN" };
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function dtf(locale: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = fmtCache.get(key);
  if (!f) fmtCache.set(key, (f = new Intl.DateTimeFormat(LOCALE_TAG[locale] ?? locale, { timeZone: "UTC", ...opts })));
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

/** Parse 'YYYY-MM' or 'YYYY-MM-DD' → { y, m }. */
export function ymParts(period: string): { y: number; m: number } {
  const [y, m] = period.split("-").map(Number);
  return { y, m };
}
