import type { APIRoute } from "astro";
import { githubRepoFullName } from "../../../../../web/lib/public-params";
import { repositoryOpenGraphData } from "../../../packages/p2/data";
import { repoOpenGraphCard } from "../../../../../web/lib/repo-og";
import { repoCard, siteCard } from "../../../../../web/lib/og-card";
export const prerender = false;
export const GET: APIRoute = async ({ params, locals }) => {
  const requested = githubRepoFullName(params.owner ?? "", params.name ?? "");
  if (!requested) return siteCard();
  const { id, repo } = await repositoryOpenGraphData(locals.data, requested);
  const card = repoOpenGraphCard(id, repo);
  return card.kind === "generic" ? siteCard() : repoCard(card);
};
export const HEAD: APIRoute = GET;
