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
