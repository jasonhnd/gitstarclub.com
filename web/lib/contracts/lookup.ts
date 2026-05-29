import { z } from "zod";
import { OwnerType } from "./common";

// lookup/*.json — minimal join tables read by build to render rank lists/cards.
// Full metadata lives in entity/*. See docs/DATA-CONTRACTS.md §2.1–2.2.

export const RepoLookupEntry = z.object({
  owner: z.string(),
  name: z.string(),
  full_name: z.string(),
  owner_type: OwnerType,
  language: z.string().nullable(),
  current_stars: z.number().int(),
});
export type RepoLookupEntry = z.infer<typeof RepoLookupEntry>;

/** lookup/repos.json — keyed by repo id (stringified). */
export const ReposLookup = z.record(z.string(), RepoLookupEntry);
export type ReposLookup = z.infer<typeof ReposLookup>;

export const OrgLookupEntry = z.object({
  login: z.string(),
  owner_type: OwnerType,
  repo_count: z.number().int(),
  current_stars_sum: z.number().int(),
});
export type OrgLookupEntry = z.infer<typeof OrgLookupEntry>;

/** lookup/orgs.json — keyed by owner login. */
export const OrgsLookup = z.record(z.string(), OrgLookupEntry);
export type OrgsLookup = z.infer<typeof OrgsLookup>;
