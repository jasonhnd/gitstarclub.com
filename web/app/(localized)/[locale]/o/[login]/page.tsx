import { createLocalizedPage } from "@/app/_localized/page-adapter";
import { generateOrgMetadata, OrgPageView } from "@/app/_localized/org";
import { LONG_TAIL_REVALIDATE_SECONDS } from "@/lib/data/publication-cache-contract";

export const dynamicParams = true;
export const revalidate = LONG_TAIL_REVALIDATE_SECONDS;

// Do not prebuild the org x locale cross-product. Localized org pages are
// generated on demand and then refreshed by targeted invalidation.
export function generateStaticParams() {
  return [];
}

const route = createLocalizedPage<{ login: string }>({
  generateMetadata: ({ locale, params: { login } }) => generateOrgMetadata({ locale, login }),
  render: ({ locale, params: { login } }) => <OrgPageView locale={locale} login={login} />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
