import { createEnglishPage } from "@/app/_localized/page-adapter";
import { generateOrgIndexMetadata, OrgIndexPageView } from "@/app/_localized/org-index";

export const revalidate = 3600;

const route = createEnglishPage({
  generateMetadata: ({ locale }) => generateOrgIndexMetadata({ locale, page: 1 }),
  render: ({ locale }) => <OrgIndexPageView locale={locale} page={1} />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
