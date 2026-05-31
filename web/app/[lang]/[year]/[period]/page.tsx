import { redirect } from "next/navigation";
import { parseLang, localePrefix } from "@/lib/i18n";

export default async function LegacyPeriodRedirect({ params }: { params: Promise<{ lang: string; year: string; period: string }> }) {
  const { lang, year, period } = await params;
  const loc = parseLang(lang) ?? "en";
  redirect(`${localePrefix(loc)}/rankings/${year}/${period}`);
}
