import type { Metadata } from "next";
import { generateOrgMetadata, OrgPageView } from "@/app/_localized/org";

export const dynamicParams = true;
export const revalidate = 86400;

// The org set is large and versioned. Keep this empty so org pages are generated
// on first request and then refreshed by targeted invalidation.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ login: string }> }): Promise<Metadata> {
  const { login } = await params;
  return generateOrgMetadata({ locale: "en", login });
}

export default async function OrgPage({ params }: { params: Promise<{ login: string }> }) {
  const { login } = await params;
  return <OrgPageView locale="en" login={login} />;
}
