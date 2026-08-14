import { createEnglishPage } from "@/app/_localized/page-adapter";
import { generateOrgMetadata, OrgPageView } from "@/app/_localized/org";
export const dynamicParams = true;
export const revalidate = 604800;

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
