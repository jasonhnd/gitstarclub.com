import MiniSearch from "minisearch";
import type { SearchDoc } from "@/lib/contracts";

// Pure MiniSearch wiring, built in the browser from /search-index and also unit-tested under
// bun. The SearchBox dynamically imports this on first focus so MiniSearch stays out of the
// initial client bundle.

export interface SearchHit {
  id: number;
  full_name: string;
  owner: string;
  language: string | null;
  current_stars: number;
  description: string | null;
}

const FIELDS = ["full_name", "owner", "description", "language"];
const STORE = ["full_name", "owner", "language", "current_stars", "description"];

/** Popularity multiplier: ~1 at 1 star, ~3 at 10k, ~3.5 at 100k — keeps well-known repos on top. */
function starBoost(stars: number): number {
  return 1 + Math.log10(Math.max(1, stars)) / 2;
}

export function createIndex(repos: ReadonlyArray<SearchDoc>): MiniSearch<SearchDoc> {
  const ms = new MiniSearch<SearchDoc>({
    idField: "id",
    fields: FIELDS,
    storeFields: STORE,
    // Fields are nullable in the contract; coerce null/undefined to "" so the tokenizer is total.
    extractField: (doc, field) => {
      const v = (doc as Record<string, unknown>)[field];
      return v == null ? "" : String(v);
    },
    searchOptions: {
      boost: { full_name: 3, owner: 2 },
      prefix: true,
      fuzzy: 0.2,
      boostDocument: (_id, _term, stored) =>
        starBoost(Number((stored as { current_stars?: number } | undefined)?.current_stars ?? 0)),
    },
  });
  ms.addAll(repos as SearchDoc[]);
  return ms;
}

export function queryIndex(ms: MiniSearch<SearchDoc>, raw: string, limit = 8): SearchHit[] {
  const q = raw.trim();
  if (!q) return [];
  return ms.search(q).slice(0, limit).map((r) => ({
    id: Number(r.id),
    full_name: String(r.full_name),
    owner: String(r.owner),
    language: (r.language as string) || null,
    current_stars: Number(r.current_stars),
    description: (r.description as string) || null,
  }));
}
