import type { Metadata } from "next";
import { generateRankingsMetadata, RankingsPageView } from "@/app/_localized/rankings";

export const revalidate = false;

export async function generateMetadata(): Promise<Metadata> {
  return generateRankingsMetadata("en");
}

export default function RankingsPage() {
  return <RankingsPageView locale="en" />;
}
