import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMeta } from "@/lib/seo";
import { parseLang, getDictionary } from "@/lib/i18n";
import { PulseView } from "./PulseView";

export const revalidate = false;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const loc = parseLang((await params).lang);
  if (!loc) return {};
  return pageMeta({
    title: "Open Source Pulse — Weekly, Monthly & Yearly GitHub Movers",
    description: "The current pulse of open source: this week's, this month's, and this year's fastest-rising GitHub repositories.",
    path: "/pulse",
    locale: loc,
  });
}

export default async function PulsePage({ params }: { params: Promise<{ lang: string }> }) {
  const loc = parseLang((await params).lang);
  if (!loc) notFound();
  const t = await getDictionary(loc);
  return <PulseView locale={loc} t={t} />;
}
