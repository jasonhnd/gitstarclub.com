import { createLocalizedPage } from "@/app/_localized/page-adapter";
import { generatePrivacyMetadata, PrivacyPageView } from "@/app/_localized/privacy";
import { generateCoreLocaleStaticParams } from "@/app/_localized/routing";

export const revalidate = false;

export const generateStaticParams = generateCoreLocaleStaticParams;

const route = createLocalizedPage({
  generateMetadata: ({ locale }) => generatePrivacyMetadata(locale),
  render: ({ locale }) => <PrivacyPageView locale={locale} />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
