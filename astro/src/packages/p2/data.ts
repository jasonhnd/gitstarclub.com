import { type CategoryRegistry, type Meta, type ReposLookup } from "../../../../web/lib/contracts";
import { getDictionary, type Dict, type Locale } from "../../../../web/lib/i18n";
import { localizedPath, toBcp47Locale } from "../../../../web/lib/i18n/routing";
import { githubRepoFullName } from "../../../../web/lib/public-params";
import { type RepoPageEntity } from "../../../../web/lib/repo-readiness";
import { resolveRepoRoute } from "../../../../web/lib/repo-route";
import { formatTemplate } from "../../../../web/lib/template-format";
import type { pageData } from "../../lib/data";

import { DAILY_BASE_VIEW_TTL_MS, getAliasMapDaily, getCategoryRegistry, getMeta, getRepoIdByFullNameDaily, getRepoPageEntityDaily, getReposLookupDaily } from "../../../../web/lib/data";
import { getRepoCurve } from "../../../../web/lib/data/compare";
import { withPublishedReaders } from "../../lib/published-readers";

type Data = ReturnType<typeof pageData>;
export type RepositoryPage = {
  locale: Locale; t: Dict; repo: RepoPageEntity;
  lookup: ReposLookup | null; registry: CategoryRegistry | null; meta: Meta | null;
};
export type RepositoryResolution = { kind: "missing" } | { kind: "redirect"; location: string } | { kind: "page"; page: RepositoryPage };

/** Keep the existing readers inside the shared captured-publication transport. */
export function loadRepository(data: Data, locale: Locale, owner: string, name: string): Promise<RepositoryResolution> {
  return withPublishedReaders(data, async (): Promise<RepositoryResolution> => {
    const fullName = githubRepoFullName(owner, name);
    if (!fullName) return { kind: "missing" };
    const ids = await getRepoIdByFullNameDaily();
    let route = resolveRepoRoute(fullName, ids, null, null);
    if (route.kind === "missing") route = resolveRepoRoute(fullName, ids, await getAliasMapDaily(), await getReposLookupDaily());
    if (route.kind === "redirect") return { kind: "redirect", location: localizedPath(locale, route.location) };
    if (route.kind !== "found") return { kind: "missing" };
    const [repo, lookup, t, registry, meta] = await Promise.all([
      getRepoPageEntityDaily(route.id), getReposLookupDaily(), getDictionary(locale),
      getCategoryRegistry(), getMeta(DAILY_BASE_VIEW_TTL_MS),
    ]);
    if (!repo) return { kind: "missing" };
    // The current Cloudflare page deliberately skips category assignment fan-out.
    return { kind: "page", page: { locale, t, repo, lookup, registry, meta } };
  });
}

export function repositoryMetadata({ locale, t, repo }: RepositoryPage) {
  return {
    title: `${repo.full_name} — ${t.repo.metaTitleSuffix}`,
    description: formatTemplate(t.repo.metaDescription, { repo: repo.full_name, stars: repo.current_stars.toLocaleString(toBcp47Locale(locale)) }),
    canonicalPath: `/${repo.full_name}`,
    ogImage: `/${repo.full_name}/opengraph-image`,
  };
}

/** Reuse the original projection, including its response property insertion order. */
export function repositoryCurve(data: Data, id: number) {
  return withPublishedReaders(data, () => getRepoCurve(id));
}

export function repositoryOpenGraphData(data: Data, requested: string) {
  return withPublishedReaders(data, async () => {
    const id = (await getRepoIdByFullNameDaily()).get(requested.toLowerCase());
    return { id, repo: id === undefined ? null : await getRepoPageEntityDaily(id) };
  });
}
