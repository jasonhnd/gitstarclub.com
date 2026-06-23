// DEPRECATED: reading the language cookie server-side forces every page that calls this to
// render dynamically (`ƒ`), defeating the static/ISR scale model. Pages render default-locale
// chrome into static HTML; language changes are handled by small client islands.
// Kept only for any non-page server context that legitimately needs the cookie; do NOT call
// this from a page or layout, or it will opt that route out of static rendering.
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LANG_COOKIE, getDictionary, isLocale, type Locale, type Dict } from ".";

export async function getPreferredLocale(): Promise<Locale> {
  const value = (await cookies()).get(LANG_COOKIE)?.value;
  return value && isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function getPreferredDictionary(): Promise<{ locale: Locale; t: Dict }> {
  const locale = await getPreferredLocale();
  return { locale, t: await getDictionary(locale) };
}
