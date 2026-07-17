import { createEnglishPage } from "@/app/_localized/page-adapter";
import { generateRepoMetadata, RepoPageView } from "@/app/_localized/repo";

export const dynamicParams = true;
export const revalidate = 86400;

// The repo set is large and versioned. Keep this empty so repo pages are generated
// on first request and then served through ISR instead of deploy-time SSG.
export function generateStaticParams() {
  return [];
}

// The file-system parameter names intentionally align with the localized route
// tree (`/[locale]/[owner]/[name]`) so Next can merge both route groups. On the
// unprefixed English route, the first two segments still mean owner and repo name.
const route = createEnglishPage<{ locale: string; owner: string }>({
  generateMetadata: ({ locale, params: { locale: owner, owner: name } }) =>
    generateRepoMetadata({ locale, owner, name }),
  render: ({ locale, params: { locale: owner, owner: name } }) =>
    <RepoPageView locale={locale} owner={owner} name={name} />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
