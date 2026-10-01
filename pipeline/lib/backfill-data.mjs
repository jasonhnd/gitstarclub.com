// Pure helpers shared by the one-time backfill exporters. No I/O or environment reads.
import { buildBootstrapPhaseManifest, sha256Bytes } from "./bootstrap-publication.mjs";

export const BACKFILL_BUCKETS = 32;
export const num = (v) => (typeof v === "bigint" ? Number(v) : v);
export const bucketOf = (id) => id % BACKFILL_BUCKETS;

export function groupBy(arr, keyOf) {
  const m = new Map();
  for (const x of arr) {
    const k = keyOf(x);
    let a = m.get(k);
    if (!a) m.set(k, (a = []));
    a.push(x);
  }
  return m;
}

/** Consume rows (sorted by repo_id asc) for the current id; advances ptr.i. */
export function drain(arr, ptr, id) {
  const out = [];
  while (ptr.i < arr.length && num(arr[ptr.i].repo_id) === id) out.push(arr[ptr.i++]);
  return out;
}

export function addDays(ymd, days) {
  const dt = new Date(`${ymd}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function timestampFromGeneration(value) {
  const match = /^bootstrap-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z(?:-|$)/.exec(value ?? "");
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
}

/** Group `[repo_id,...]` rows into `{ bucket: { id: [valueFn(row), ...] } }`. */
export function bucketSeries(rows, valueFn) {
  const buckets = new Map(); // bucket -> { id: array }
  for (const r of rows) {
    const id = num(r.repo_id);
    const b = bucketOf(id);
    let bm = buckets.get(b);
    if (!bm) buckets.set(b, (bm = {}));
    (bm[id] ??= []).push(valueFn(r));
  }
  return buckets;
}

export function assertLocalManifestMatches(generation, phase, localItems, remotePhase) {
  const local = buildBootstrapPhaseManifest(generation, phase, localItems);
  const digest = sha256Bytes(Buffer.from(JSON.stringify(local)));
  if (digest !== remotePhase.sha256) {
    throw new Error(`${phase} local validation input does not match sealed remote manifest`);
  }
}
