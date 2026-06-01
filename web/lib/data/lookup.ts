import { cache } from "react";
import { ReposLookup, OrgsLookup } from "@/lib/contracts";
import { readView } from "./source";

// Join tables (id/login → display fields). Rank lists store only ids; build joins these in.

export const getReposLookup = cache(() => readView("lookup/repos.json", ReposLookup));
export const getOrgsLookup = cache(() => readView("lookup/orgs.json", OrgsLookup));

/** Reverse index full_name → repo id, for /[owner]/[name] → entity/repo/{id}. */
export const getRepoIdByFullName = cache(async () => {
  const lookup = await getReposLookup();
  const map = new Map<string, number>();
  if (lookup) for (const [id, entry] of Object.entries(lookup)) map.set(entry.full_name.toLowerCase(), Number(id));
  return map;
});
