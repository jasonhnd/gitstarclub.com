import { createLocalizedPage } from "@/app/_localized/page-adapter";
import { generatePulseMetadata, PulsePageView } from "@/app/_localized/pulse";
import { generateCoreLocaleStaticParams } from "@/app/_localized/routing";

export const revalidate = false;

export const generateStaticParams = generateCoreLocaleStaticParams;

const route = createLocalizedPage({
  generateMetadata: ({ locale }) => generatePulseMetadata({ locale, canonicalPath: "/pulse" }),
  render: ({ locale }) => <PulsePageView locale={locale} canonicalPath="/pulse" />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
