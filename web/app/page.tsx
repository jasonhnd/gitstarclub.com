import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import { getPreferredDictionary } from "@/lib/i18n/server";
import { PulseView } from "./pulse/PulseView";

export const revalidate = false;

export async function generateMetadata(): Promise<Metadata> {
  return pageMeta({
    absoluteTitle: true,
    title: "Open Source Pulse & GitHub Star History · GitStarClub",
    description:
      "See the current pulse of open source: this week's, this month's, and this year's fastest-rising GitHub projects, plus all-time star rankings.",
    path: "/",
    locale: "en",
  });
}

export default async function Home() {
  const { locale, t } = await getPreferredDictionary();
  return <PulseView locale={locale} t={t} includeWebsiteLd />;
}
