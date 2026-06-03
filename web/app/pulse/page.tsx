import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import { PulseView } from "./PulseView";

export const revalidate = false;

export async function generateMetadata(): Promise<Metadata> {
  return pageMeta({
    title: "Open Source Pulse — Weekly, Monthly & Yearly GitHub Movers",
    description: "The current pulse of open source: this week's, this month's, and this year's fastest-rising GitHub repositories.",
    path: "/pulse",
    locale: "en",
  });
}

export default function PulsePage() {
  return <PulseView />;
}
