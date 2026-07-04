import type { Metadata } from "next";
import { generatePulseMetadata, PulsePageView } from "@/app/_localized/pulse";

export const revalidate = false;

export async function generateMetadata(): Promise<Metadata> {
  return generatePulseMetadata({ locale: "en", canonicalPath: "/", absoluteTitle: true });
}

export default function Home() {
  return <PulsePageView locale="en" canonicalPath="/" includeWebsiteLd />;
}
