import type { Metadata } from "next";
import { generateRepoMetadata, RepoPageView } from "@/app/_localized/repo";

export const dynamicParams = true;
export const revalidate = 86400;

// The repo set is large and versioned. Keep this empty so repo pages are generated
// on first request and then served through ISR instead of deploy-time SSG.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ owner: string; name: string }> }): Promise<Metadata> {
  const { owner, name } = await params;
  return generateRepoMetadata({ locale: "en", owner, name });
}

export default async function RepoPage({ params }: { params: Promise<{ owner: string; name: string }> }) {
  const { owner, name } = await params;
  return <RepoPageView locale="en" owner={owner} name={name} />;
}
