import { isReservedLocalizedTopLevelRoute } from "@/lib/i18n/routing";
import { notFound } from "next/navigation";
import { createLocalizedPage } from "@/app/_localized/page-adapter";
import { generateRepoMetadata, RepoPageView } from "@/app/_localized/repo";
import { LONG_TAIL_REVALIDATE_SECONDS } from "@/lib/data/publication-cache-contract";

export const dynamicParams = true;
export const revalidate = LONG_TAIL_REVALIDATE_SECONDS;

// Do not prebuild the repo x locale cross-product. Localized repo pages are
// generated on demand and then served through ISR.
export function generateStaticParams() {
  return [];
}

const route = createLocalizedPage<{ owner: string; name: string }>({
  generateMetadata: ({ locale, params: { owner, name } }) => {
    if (isReservedLocalizedTopLevelRoute(owner)) notFound();
    return generateRepoMetadata({ locale, owner, name });
  },
  render: ({ locale, params: { owner, name } }) => {
    if (isReservedLocalizedTopLevelRoute(owner)) notFound();
    return <RepoPageView locale={locale} owner={owner} name={name} />;
  },
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
