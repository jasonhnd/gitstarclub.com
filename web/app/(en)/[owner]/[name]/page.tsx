import { createEnglishPage } from "@/app/_localized/page-adapter";
import { generateRepoMetadata, RepoPageView } from "@/app/_localized/repo";

export const dynamicParams = true;
export const revalidate = 86400;

// The repo set is large and versioned. Keep this empty so repo pages are generated
// on first request and then served through ISR instead of deploy-time SSG.
export function generateStaticParams() {
  return [];
}

const route = createEnglishPage<{ owner: string; name: string }>({
  generateMetadata: ({ locale, params: { owner, name } }) => generateRepoMetadata({ locale, owner, name }),
  render: ({ locale, params: { owner, name } }) => <RepoPageView locale={locale} owner={owner} name={name} />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
