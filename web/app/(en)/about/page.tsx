import { createEnglishPage } from "@/app/_localized/page-adapter";
import { AboutPageView, generateAboutMetadata } from "@/app/_localized/about";

export const revalidate = false;

const route = createEnglishPage({
  generateMetadata: ({ locale }) => generateAboutMetadata(locale),
  render: ({ locale }) => <AboutPageView locale={locale} />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
