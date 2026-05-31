import { redirect } from "next/navigation";
import { parseLang, localePrefix } from "@/lib/i18n";

export default async function TrendingRedirect({ params }: { params: Promise<{ lang: string }> }) {
  const loc = parseLang((await params).lang) ?? "en";
  redirect(`${localePrefix(loc)}/pulse`);
}
