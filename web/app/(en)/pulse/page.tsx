import type { Metadata } from "next";
import { generatePulseMetadata, PulsePageView } from "@/app/_localized/pulse";

export const revalidate = false;

export async function generateMetadata(): Promise<Metadata> {
  return generatePulseMetadata({ locale: "en", canonicalPath: "/pulse" });
}

export default function PulsePage() {
  return <PulsePageView locale="en" canonicalPath="/pulse" />;
}
