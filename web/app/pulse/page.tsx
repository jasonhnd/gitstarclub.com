import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import { PULSE_META_DESCRIPTION, PULSE_META_TITLE } from "@/lib/site-copy";
import { PulseView } from "./PulseView";

export const revalidate = false;

export async function generateMetadata(): Promise<Metadata> {
  return pageMeta({
    title: PULSE_META_TITLE,
    description: PULSE_META_DESCRIPTION,
    path: "/pulse",
    locale: "en",
  });
}

export default function PulsePage() {
  return <PulseView />;
}
