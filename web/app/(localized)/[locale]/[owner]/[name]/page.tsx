import type { Metadata } from "next";
import { isReservedLocalizedTopLevelRoute } from "@/lib/i18n/routing";
import { notFound } from "next/navigation";
import { generateRepoMetadata, RepoPageView } from "@/app/_localized/repo";
import { resolveLocaleSegment } from "@/app/_localized/routing";

export const dynamicParams = true;
export const revalidate = 86400;

// Do not prebuild the repo x locale cross-product. Localized repo pages are
// generated on demand and then served through ISR.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; owner: string; name: string }> }): Promise<Metadata> {
  const { locale, owner, name } = await params;
  const routeLocale = resolveLocaleSegment(locale);
  if (isReservedLocalizedTopLevelRoute(owner)) notFound();
  return generateRepoMetadata({ locale: routeLocale, owner, name });
}

export default async function LocalizedRepoPage({ params }: { params: Promise<{ locale: string; owner: string; name: string }> }) {
  const { locale, owner, name } = await params;
  const routeLocale = resolveLocaleSegment(locale);
  if (isReservedLocalizedTopLevelRoute(owner)) notFound();
  return <RepoPageView locale={routeLocale} owner={owner} name={name} />;
}
