import { z } from "zod";
import { NonNegativeInt, OwnerType, SafeText } from "./common";

// lookup/*.json — minimal join tables read by build to render rank lists/cards.
// Full metadata lives in entity/*. See docs/DATA-CONTRACTS.md §2.1–2.2.

export const RepoLookupEntry = z.object({
  owner: SafeText,
  name: SafeText,
  full_name: SafeText,
  owner_type: OwnerType,
  language: SafeText.nullable(),
  current_stars: NonNegativeInt,
}).strict();
export type RepoLookupEntry = z.infer<typeof RepoLookupEntry>;

/** lookup/repos.json — keyed by repo id (stringified). */
export const ReposLookup = z.record(z.string(), RepoLookupEntry);
export type ReposLookup = z.infer<typeof ReposLookup>;

export const OrgLookupEntry = z.object({
  login: SafeText,
  owner_type: OwnerType,
  repo_count: NonNegativeInt,
  current_stars_sum: NonNegativeInt,
}).strict();
export type OrgLookupEntry = z.infer<typeof OrgLookupEntry>;

/** lookup/orgs.json — keyed by owner login. */
export const OrgsLookup = z.record(z.string(), OrgLookupEntry);
export type OrgsLookup = z.infer<typeof OrgsLookup>;

/** lookup/aliases.json — old (renamed-away) full_name (lowercased) → current repo id.
 *  The repo route 308-redirects a stale slug to the id's current full_name. repo_id is stable
 *  across GitHub renames, so the redirect target is resolved fresh from ReposLookup at request
 *  time. Built by the buildAliases workflow step. See docs/DATA-CONTRACTS.md. */
export const AliasMap = z.record(SafeText, NonNegativeInt);
export type AliasMap = z.infer<typeof AliasMap>;
