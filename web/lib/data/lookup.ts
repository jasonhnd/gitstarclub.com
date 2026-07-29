import { cache } from "react";
import { ReposLookup, OrgsLookup, AliasMap } from "@/lib/contracts";
import { DAILY_BASE_VIEW_OPTS, readAuthoritativeView, readView } from "./source";

// Join tables (id/login → display fields). Rank lists store only ids; build joins these in.

// base:true → versioned lookup via the publish pointer; flat fallback when no pointer (first run).
// Page getters retain published-read fallback semantics. Mutation paths use the
// authoritative variant below. See VERCEL-DATA-OPERATIONS §7.
export const getReposLookup = cache(() => readView("lookup/repos.json", ReposLookup, { base: true }));
export const getOrgsLookup = cache(() => readView("lookup/orgs.json", OrgsLookup, { base: true }));
export const getReposLookupDaily = cache(() => readView("lookup/repos.json", ReposLookup, DAILY_BASE_VIEW_OPTS));
/** Mutation-path lookup: transport/pointer failures must not become an empty live refresh input. */
export const getReposLookupAuthoritative = () =>
  readAuthoritativeView("lookup/repos.json", ReposLookup, { base: true });

/** lookup/aliases.json — old full_name (lowercased) → current repo id. Consulted by the repo
 *  route on a slug miss to 308-redirect a renamed repo's stale URL. Absent before the first
 *  alias-producing refresh → readView returns null and the route falls through to notFound(). */
export const getAliasMap = cache(() => readView("lookup/aliases.json", AliasMap, { base: true }));
export const getAliasMapDaily = cache(() => readView("lookup/aliases.json", AliasMap, DAILY_BASE_VIEW_OPTS));

/** Reverse index full_name → repo id, for /[owner]/[name] → entity/repo/{id}. */
export const getRepoIdByFullName = cache(async () => {
  const lookup = await getReposLookup();
  const map = new Map<string, number>();
  if (lookup) for (const [id, entry] of Object.entries(lookup)) map.set(entry.full_name.toLowerCase(), Number(id));
  return map;
});

export const getRepoIdByFullNameDaily = cache(async () => {
  const lookup = await getReposLookupDaily();
  const map = new Map<string, number>();
  if (lookup) for (const [id, entry] of Object.entries(lookup)) map.set(entry.full_name.toLowerCase(), Number(id));
  return map;
});
