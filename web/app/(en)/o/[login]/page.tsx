import { createEnglishPage } from "@/app/_localized/page-adapter";
import { generateOrgMetadata, OrgPageView } from "@/app/_localized/org";
import { LONG_TAIL_REVALIDATE_SECONDS } from "@/lib/data/publication-cache-contract";

export const dynamicParams = true;
export const revalidate = LONG_TAIL_REVALIDATE_SECONDS;

// The org set is large and versioned. Keep this empty so org pages are generated
// on first request and then refreshed by targeted invalidation.
export function generateStaticParams() {
  return [];
}

const route = createEnglishPage<{ login: string }>({
  generateMetadata: ({ locale, params: { login } }) => generateOrgMetadata({ locale, login }),
  render: ({ locale, params: { login } }) => <OrgPageView locale={locale} login={login} />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
