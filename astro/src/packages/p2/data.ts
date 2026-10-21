import { AliasMap, CategoryRegistry, Meta, RepoEntity, ReposLookup, type CompareCurve } from "../../../../web/lib/contracts";
import { getDictionary, type Dict, type Locale } from "../../../../web/lib/i18n";
import { localizedPath, toBcp47Locale } from "../../../../web/lib/i18n/routing";
import { githubRepoFullName } from "../../../../web/lib/public-params";
import { normalizeRepoPageEntity, type RepoPageEntity } from "../../../../web/lib/repo-readiness";
import { resolveRepoRoute } from "../../../../web/lib/repo-route";
import { formatTemplate } from "../../../../web/lib/template-format";
import type { pageData } from "../../lib/data";

type Data = ReturnType<typeof pageData>;
export type RepositoryPage = {
  locale: Locale; t: Dict; repo: RepoPageEntity;
  lookup: ReposLookup | null; registry: CategoryRegistry | null; meta: Meta | null;
};
export type RepositoryResolution = { kind: "missing" } | { kind: "redirect"; location: string } | { kind: "page"; page: RepositoryPage };

/** Reuse the published schemas and tolerant page normalization over P0's captured generation. */
export async function loadRepository(data: Data, locale: Locale, owner: string, name: string): Promise<RepositoryResolution> {
  const fullName = githubRepoFullName(owner, name);
  if (!fullName) return { kind: "missing" };
  const lookup = await data.base("lookup/repos.json", ReposLookup);
  const ids = new Map(Object.entries(lookup ?? {}).map(([id, repo]) => [repo.full_name.toLowerCase(), Number(id)]));
  let route = resolveRepoRoute(fullName, ids, null, null);
  if (route.kind === "missing") route = resolveRepoRoute(fullName, ids, await data.base("lookup/aliases.json", AliasMap), lookup);
  if (route.kind === "redirect") return { kind: "redirect", location: localizedPath(locale, route.location) };
  if (route.kind !== "found") return { kind: "missing" };
  const id = route.id;
  const raw = await data.base(`entity/repo/${id}.json`, { parse: (value: unknown) => value });
  const repo = normalizeRepoPageEntity(raw, id);
  if (!repo) return { kind: "missing" };
  const [t, registry, meta] = await Promise.all([
    getDictionary(locale), data.base("categories/registry.json", CategoryRegistry), data.base("meta.json", Meta),
  ]);
  // The current Cloudflare page deliberately skips category assignment fan-out.
  return { kind: "page", page: { locale, t, repo, lookup, registry, meta } };
}

export function repositoryMetadata({ locale, t, repo }: RepositoryPage) {
  return {
    title: `${repo.full_name} — ${t.repo.metaTitleSuffix}`,
    description: formatTemplate(t.repo.metaDescription, { repo: repo.full_name, stars: repo.current_stars.toLocaleString(toBcp47Locale(locale)) }),
    canonicalPath: `/${repo.full_name}`,
    ogImage: `/${repo.full_name}/opengraph-image`,
  };
}

/** Keep the strict curve contract and insertion order used by web/lib/data/compare. */
export async function repositoryCurve(data: Data, id: number): Promise<CompareCurve | null> {
  const repo = await data.base(`entity/repo/${id}.json`, RepoEntity);
  if (!repo) return null;
  return {
    id: repo.id, full_name: repo.full_name, current_stars: repo.current_stars,
    crossed_10k: repo.milestones.crossed_10k,
    points: repo.curve.monthly.map(([period, , total]) => [period, total]),
  };
}
