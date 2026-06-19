import { cache } from "react";
import { ReposLookup, OrgsLookup, AliasMap } from "@/lib/contracts";
import { readView } from "./source";

// Join tables (id/login → display fields). Rank lists store only ids; build joins these in.

// base:true → versioned lookup via the publish pointer; flat fallback when no pointer (first run).
// The metadata workflow step also calls these: pre-publish it reads the previous version (or flat
// bootstrap on the very first run), both valid owner_type/language seeds. See VERCEL-DATA-OPERATIONS §7.
export const getReposLookup = cache(() => readView("lookup/repos.json", ReposLookup, { base: true }));
export const getOrgsLookup = cache(() => readView("lookup/orgs.json", OrgsLookup, { base: true }));

/** lookup/aliases.json — old full_name (lowercased) → current repo id. Consulted by the repo
 *  route on a slug miss to 308-redirect a renamed repo's stale URL. Absent before the first
 *  alias-producing refresh → readView returns null and the route falls through to notFound(). */
export const getAliasMap = cache(() => readView("lookup/aliases.json", AliasMap, { base: true }));

/** Reverse index full_name → repo id, for /[owner]/[name] → entity/repo/{id}. */
export const getRepoIdByFullName = cache(async () => {
  const lookup = await getReposLookup();
  const map = new Map<string, number>();
  if (lookup) for (const [id, entry] of Object.entries(lookup)) map.set(entry.full_name.toLowerCase(), Number(id));
  return map;
});
