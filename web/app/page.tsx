import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import { PULSE_META_DESCRIPTION, PULSE_META_TITLE } from "@/lib/site-copy";
import { PulseView } from "./pulse/PulseView";

export const revalidate = false;

export async function generateMetadata(): Promise<Metadata> {
  return pageMeta({
    absoluteTitle: true,
    title: `${PULSE_META_TITLE} · GitStarClub`,
    description: PULSE_META_DESCRIPTION,
    path: "/",
    locale: "en",
  });
}

export default function Home() {
  return <PulseView includeWebsiteLd />;
}
