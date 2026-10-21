import type { APIRoute } from "astro";
import { ReposLookup } from "../../../../../web/lib/contracts";
import { githubRepoFullName } from "../../../../../web/lib/public-params";
import { normalizeRepoPageEntity } from "../../../../../web/lib/repo-readiness";
import { repoOpenGraphCard } from "../../../../../web/lib/repo-og";
import { repoCard, siteCard } from "../../../../../web/lib/og-card";
export const prerender = false;
export const GET: APIRoute = async ({ params, locals }) => {
  const requested = githubRepoFullName(params.owner ?? "", params.name ?? "");
  if (!requested) return siteCard();
  const lookup = await locals.data.base("lookup/repos.json", ReposLookup);
  const pair = Object.entries(lookup ?? {}).find(([, repo]) => repo.full_name.toLowerCase() === requested.toLowerCase());
  const id = pair ? Number(pair[0]) : undefined;
  const raw = id === undefined ? null : await locals.data.base(`entity/repo/${id}.json`, { parse: (value: unknown) => value });
  const card = repoOpenGraphCard(id, normalizeRepoPageEntity(raw, id));
  return card.kind === "generic" ? siteCard() : repoCard(card);
};
export const HEAD: APIRoute = GET;
