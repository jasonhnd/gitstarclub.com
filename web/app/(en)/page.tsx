import { createEnglishPage } from "@/app/_localized/page-adapter";
import { generatePulseMetadata, PulsePageView } from "@/app/_localized/pulse";

export const revalidate = false;

const route = createEnglishPage({
  generateMetadata: ({ locale }) => generatePulseMetadata({ locale, canonicalPath: "/", absoluteTitle: true }),
  render: ({ locale }) => <PulsePageView locale={locale} canonicalPath="/" includeWebsiteLd />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
