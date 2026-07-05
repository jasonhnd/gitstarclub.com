import { createLocalizedPage } from "@/app/_localized/page-adapter";
import { AboutPageView, generateAboutMetadata } from "@/app/_localized/about";
import { generateCoreLocaleStaticParams } from "@/app/_localized/routing";

export const revalidate = false;

export const generateStaticParams = generateCoreLocaleStaticParams;

const route = createLocalizedPage({
  generateMetadata: ({ locale }) => generateAboutMetadata(locale),
  render: ({ locale }) => <AboutPageView locale={locale} />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
