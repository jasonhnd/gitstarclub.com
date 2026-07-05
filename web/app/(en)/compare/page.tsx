import type { Metadata } from "next";
import { generateCompareMetadata, ComparePageView } from "@/app/_localized/compare";

export const dynamic = "force-static";
export const revalidate = false;

export async function generateMetadata(): Promise<Metadata> {
  return generateCompareMetadata("en");
}

export default function ComparePage() {
  return <ComparePageView locale="en" />;
}
