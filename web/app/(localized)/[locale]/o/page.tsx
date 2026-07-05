import { createLocalizedPage } from "@/app/_localized/page-adapter";
import { generateOrgIndexMetadata, OrgIndexPageView } from "@/app/_localized/org-index";

export const dynamicParams = true;
export const revalidate = 3600;

// Keep localized org index pages on-demand instead of prebuilding a locale
// multiplier for the owner directory.
export function generateStaticParams() {
  return [];
}

const route = createLocalizedPage({
  generateMetadata: ({ locale }) => generateOrgIndexMetadata({ locale, page: 1 }),
  render: ({ locale }) => <OrgIndexPageView locale={locale} page={1} />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
