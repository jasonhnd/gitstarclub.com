import { createEnglishPage } from "@/app/_localized/page-adapter";
import { generateRepoMetadata, RepoPageView } from "@/app/_localized/repo";

export const dynamicParams = true;
export const revalidate = 86400;

// The repo set is large and versioned. Keep this empty so repo pages are generated
// on first request and then served through ISR instead of deploy-time SSG.
export function generateStaticParams() {
  return [];
}

type EnglishRepoParams = {
  /** Public repo owner from the first URL segment. Named to match localized route tree constraints. */
  locale: string;
  /** Public repo name from the second URL segment. */
  owner: string;
};

function publicRepoParams(params: EnglishRepoParams): { owner: string; name: string } {
  return { owner: params.locale, name: params.owner };
}

const route = createEnglishPage<EnglishRepoParams>({
  generateMetadata: ({ locale, params }) => generateRepoMetadata({ locale, ...publicRepoParams(params) }),
  render: ({ locale, params }) => <RepoPageView locale={locale} {...publicRepoParams(params)} />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
