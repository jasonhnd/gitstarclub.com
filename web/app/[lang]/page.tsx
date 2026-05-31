import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMeta } from "@/lib/seo";
import { parseLang, getDictionary } from "@/lib/i18n";
import { PulseView } from "./pulse/PulseView";

export const revalidate = false;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const loc = parseLang((await params).lang);
  if (!loc) return {};
  return pageMeta({
    absoluteTitle: true,
    title: "Open Source Pulse & GitHub Star History · GitStarClub",
    description:
      "See the current pulse of open source: this week's, this month's, and this year's fastest-rising GitHub projects, plus all-time star rankings.",
    path: "/",
    locale: loc,
  });
}

export default async function Home({ params }: { params: Promise<{ lang: string }> }) {
  const loc = parseLang((await params).lang);
  if (!loc) notFound();
  const t = await getDictionary(loc);
  return <PulseView locale={loc} t={t} includeWebsiteLd />;
}
