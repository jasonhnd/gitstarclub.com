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
  /** False for dropped / historical retention rows; missing/true means current membership. */
  active: boolean;
}

const FIELDS = ["full_name", "owner", "description", "language"];
const STORE = ["full_name", "owner", "language", "current_stars", "description", "active"];

/** Popularity multiplier: ~1 at 1 star, ~3 at 10k, ~3.5 at 100k — keeps well-known repos on top. */
function starBoost(stars: number): number {
  return 1 + Math.log10(Math.max(1, stars)) / 2;
}

/** Inactive/historical rows stay findable but must not outrank current peers on equal terms. */
const INACTIVE_BOOST = 0.12;

function docIsActive(stored: { active?: boolean } | undefined): boolean {
  return stored?.active !== false;
}

export function createIndex(repos: ReadonlyArray<SearchDoc>): MiniSearch<SearchDoc> {
  const ms = new MiniSearch<SearchDoc>({
    idField: "id",
    fields: FIELDS,
    storeFields: STORE,
    // Text fields are nullable in the contract; coerce null/undefined to "" so the tokenizer is total.
    // `active` is store-only and must stay boolean (String(false) would look active).
    extractField: (doc, field) => {
      const v = (doc as Record<string, unknown>)[field];
      if (field === "active") return v !== false;
      return v == null ? "" : String(v);
    },
    searchOptions: {
      boost: { full_name: 3, owner: 2 },
      prefix: true,
      fuzzy: 0.2,
      boostDocument: (_id, _term, stored) => {
        const row = stored as { current_stars?: number; active?: boolean } | undefined;
        const popularity = starBoost(Number(row?.current_stars ?? 0));
        return docIsActive(row) ? popularity : popularity * INACTIVE_BOOST;
      },
    },
  });
  ms.addAll(repos as SearchDoc[]);
  return ms;
}

function storedIsActive(value: unknown): boolean {
  // Legacy rows omit `active`; treat them as current. Reject boolean false only.
  return value !== false;
}

function toHit(r: Record<string, unknown>): SearchHit {
  return {
    id: Number(r.id),
    full_name: String(r.full_name),
    owner: String(r.owner),
    language: (r.language as string) || null,
    current_stars: Number(r.current_stars),
    description: (r.description as string) || null,
    active: storedIsActive(r.active),
  };
}

export function queryIndex(ms: MiniSearch<SearchDoc>, raw: string, limit = 8): SearchHit[] {
  const q = raw.trim();
  if (!q) return [];
  // Score-ordered from MiniSearch (inactive already demoted via boostDocument).
  // Stable partition keeps current members ahead of historical rows of the same term.
  const ranked = ms.search(q).map((r) => toHit(r as Record<string, unknown>));
  const active: SearchHit[] = [];
  const inactive: SearchHit[] = [];
  for (const hit of ranked) {
    if (hit.active) active.push(hit);
    else inactive.push(hit);
  }
  return active.concat(inactive).slice(0, limit);
}
