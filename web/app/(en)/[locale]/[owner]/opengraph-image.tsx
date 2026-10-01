import { getRepoIdByFullNameDaily, getRepoPageEntityDaily } from "@/lib/data";
import { repoCard, siteCard, OG_SIZE } from "@/lib/og-card";
import { repoOpenGraphCard } from "@/lib/repo-og";

// Per-repo social card. The name is the stored full_name, and only after the
// path resolves to a known repo id. Anything else uses the site card.
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "GitHub star history";
export const revalidate = 86400;

export default async function Image({ params }: { params: Promise<{ locale: string; owner: string }> }) {
  const { locale: owner, owner: name } = await params;
  const requested = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
  const id = (await getRepoIdByFullNameDaily()).get(requested.toLowerCase());
  const repo = id !== undefined ? await getRepoPageEntityDaily(id) : null;
  const card = repoOpenGraphCard(id, repo);
  if (card.kind === "generic") return siteCard();
  return repoCard(card);
}
