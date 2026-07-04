import type { Metadata } from "next";
import { generatePrivacyMetadata, PrivacyPageView } from "@/app/_localized/privacy";

export const revalidate = false;

export async function generateMetadata(): Promise<Metadata> {
  return generatePrivacyMetadata("en");
}

export default function PrivacyPage() {
  return <PrivacyPageView locale="en" />;
}
