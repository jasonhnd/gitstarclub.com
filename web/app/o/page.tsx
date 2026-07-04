import type { Metadata } from "next";
import { generateOrgIndexMetadata, OrgIndexPageView } from "@/app/_localized/org-index";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  return generateOrgIndexMetadata({ locale: "en", page: 1 });
}

export default async function OrgIndexPage() {
  return <OrgIndexPageView locale="en" page={1} />;
}
