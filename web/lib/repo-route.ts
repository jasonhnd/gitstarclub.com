type RepoLookupLike = Record<string, { full_name: string }> | null | undefined;
type AliasMapLike = Record<string, number> | null | undefined;

export type RepoRouteResolution =
  | { kind: "found"; id: number }
  | { kind: "redirect"; location: string }
  | { kind: "missing" };

export function resolveRepoRoute(
  fullName: string,
  idsByFullName: Map<string, number>,
  aliases: AliasMapLike,
  repos: RepoLookupLike,
): RepoRouteResolution {
  const lower = fullName.toLowerCase();
  const id = idsByFullName.get(lower);
  if (id !== undefined) return { kind: "found", id };

  const aliasId = aliases?.[lower];
  if (aliasId !== undefined) {
    const current = repos?.[String(aliasId)]?.full_name;
    if (current && current.toLowerCase() !== lower) return { kind: "redirect", location: `/${current}` };
  }

  return { kind: "missing" };
}
