import type { Metadata } from "next";
import { generateOrgMetadata, OrgPageView } from "@/app/_localized/org";
import { resolveEnglishRoute, routeMetadata, routeView } from "@/app/_localized/page-adapters";

type Params = Promise<{ login: string }>;

export const dynamicParams = true;
export const revalidate = 86400;

// The org set is large and versioned. Keep this empty so org pages are generated
// on first request and then refreshed by targeted invalidation.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return routeMetadata(resolveEnglishRoute(params), (locale, { login }) => generateOrgMetadata({ locale, login }));
}

export default async function OrgPage({ params }: { params: Params }) {
  return routeView(resolveEnglishRoute(params), (locale, { login }) => <OrgPageView locale={locale} login={login} />);
}
