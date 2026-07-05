import type { Metadata } from "next";
import { generateRepoMetadata, RepoPageView } from "@/app/_localized/repo";
import { resolveEnglishRoute, routeMetadata, routeView } from "@/app/_localized/page-adapters";

type Params = Promise<{ owner: string; name: string }>;

export const dynamicParams = true;
export const revalidate = 86400;

// The repo set is large and versioned. Keep this empty so repo pages are generated
// on first request and then served through ISR instead of deploy-time SSG.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return routeMetadata(resolveEnglishRoute(params), (locale, { owner, name }) => generateRepoMetadata({ locale, owner, name }));
}

export default async function RepoPage({ params }: { params: Params }) {
  return routeView(resolveEnglishRoute(params), (locale, { owner, name }) => <RepoPageView locale={locale} owner={owner} name={name} />);
}
