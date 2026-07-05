import { createEnglishPage } from "@/app/_localized/page-adapter";
import { generatePrivacyMetadata, PrivacyPageView } from "@/app/_localized/privacy";

export const revalidate = false;

const route = createEnglishPage({
  generateMetadata: ({ locale }) => generatePrivacyMetadata(locale),
  render: ({ locale }) => <PrivacyPageView locale={locale} />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
