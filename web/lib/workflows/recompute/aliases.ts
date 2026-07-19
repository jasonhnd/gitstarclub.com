// Pure builder for lookup/aliases.json — old (renamed-away) full_name (lowercased) → current
// repo id. The repo route consults this on a slug miss and 308-redirects to the id's CURRENT
// full_name, so a stale URL (e.g. /facebook/react after the repo moved to /react/react) keeps
// working instead of 404ing. repo_id is stable across GitHub renames, so the redirect target is
// resolved fresh from the lookup at request time and alias rows never need rewriting later.
// Input is the UNION of every retained run's rename delta (gc never prunes ops/), so a rename
// that happened in an older run (and is no longer in the latest delta) is still covered.
// See aliases.test.ts for the full contract and docs/DATA-CONTRACTS.md.

type RenameDelta = { id: number; old_full_name: string };
type LookupEntry = { full_name: string; active?: boolean };

export function buildAliasMap(
  renameEntries: ReadonlyArray<RenameDelta>,
  currentLookup: Readonly<Record<string, LookupEntry>>,
): Record<string, number> {
  const currentById = new Map<number, string>(); // tracked id → its current full_name (lowercased)
  const liveNames = new Set<string>(); // every full_name currently in use (lowercased)
  for (const [id, entry] of Object.entries(currentLookup)) {
    const lower = entry.full_name.toLowerCase();
    currentById.set(Number(id), lower);
    if (entry.active !== false) liveNames.add(lower);
  }

  // Deterministic order: duplicate old names across runs resolve identically regardless of
  // which run surfaced them first (last after sort wins).
  const sorted = [...renameEntries].sort((a, b) =>
    a.old_full_name < b.old_full_name ? -1 : a.old_full_name > b.old_full_name ? 1 : a.id - b.id,
  );

  const aliases: Record<string, number> = {};
  for (const { id, old_full_name } of sorted) {
    const key = old_full_name.toLowerCase();
    const current = currentById.get(id);
    if (current === undefined) continue; // id no longer tracked → would redirect to a missing repo
    if (key === current) continue; // self-alias → no redirect needed
    if (liveNames.has(key)) continue; // a live repo owns this name now → live repo wins
    aliases[key] = id;
  }
  return aliases;
}
