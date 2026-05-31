import { redirect } from "next/navigation";
import { parseLang, localePrefix } from "@/lib/i18n";

export default async function LegacyYearRedirect({ params }: { params: Promise<{ lang: string; year: string }> }) {
  const { lang, year } = await params;
  const loc = parseLang(lang) ?? "en";
  redirect(`${localePrefix(loc)}/rankings/${year}`);
}
