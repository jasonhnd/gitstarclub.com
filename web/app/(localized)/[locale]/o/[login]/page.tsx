import { createLocalizedPage } from "@/app/_localized/page-adapter";
import { generateOrgMetadata, OrgPageView } from "@/app/_localized/org";
export const dynamicParams = true;
export const revalidate = 604800;

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
