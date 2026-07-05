import type { Metadata } from "next";
import { isReservedLocalizedTopLevelRoute } from "@/lib/i18n/routing";
import { notFound } from "next/navigation";
import { generateRepoMetadata, RepoPageView } from "@/app/_localized/repo";
import { resolveLocalizedRoute, routeMetadata, routeView } from "@/app/_localized/page-adapters";

export const dynamicParams = true;
export const revalidate = 86400;

// Do not prebuild the repo x locale cross-product. Localized repo pages are
// generated on demand and then served through ISR.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; owner: string; name: string }> }): Promise<Metadata> {
  return routeMetadata(resolveLocalizedRoute(params), (locale, { owner, name }) => {
    if (isReservedLocalizedTopLevelRoute(owner)) notFound();
    return generateRepoMetadata({ locale, owner, name });
  });
}

export default async function LocalizedRepoPage({ params }: { params: Promise<{ locale: string; owner: string; name: string }> }) {
  return routeView(resolveLocalizedRoute(params), (locale, { owner, name }) => {
    if (isReservedLocalizedTopLevelRoute(owner)) notFound();
    return <RepoPageView locale={locale} owner={owner} name={name} />;
  });
}
