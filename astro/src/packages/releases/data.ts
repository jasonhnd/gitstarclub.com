import { RELEASES_PATH, Releases, ViewsPointer, LatestSuccess, PipelineHealth, Meta } from "../../lib/contracts";
import type { pageData } from "../../lib/data";

export type PublicRecord = { key: string; kind: "metadata" | "pointer" | "recovery" | "health" };
export const releasePath = (id: string) => `/releases/${encodeURIComponent(id)}`;
const safeSegment = (id: string) => /^[a-zA-Z0-9._-]+$/.test(id) && id !== "." && id !== "..";

/** History is global, not relative to the currently published version. */
export async function loadRelease(data: Pick<ReturnType<typeof pageData>, "raw">, id: string) {
  const history = await data.raw(RELEASES_PATH, Releases);
  const release = history?.releases.find((record) => record.id === id);
  if (!release) return null;
  const records: PublicRecord[] = [];
  // Optional evidence may have been collected or may not have been written yet.
  // A broken optional record does not hide a valid retained release.
  async function optional<T>(key: string, schema: { parse(value: unknown): T }, matches: (value: T) => boolean, kind: PublicRecord["kind"]) {
    try {
      const value = await data.raw(key, schema);
      if (value !== null && matches(value)) records.push({ key, kind });
    } catch { /* Omit unavailable or invalid optional evidence. */ }
  }
  if (safeSegment(id)) await optional(`views/${id}/meta.json`, Meta, () => true, "metadata");
  await optional("views/latest.json", ViewsPointer, (value) => value.version === id && value.run_id === id, "pointer");
  await optional("ops/workflows/latest-success.json", LatestSuccess, (value) => value.run_id === id && value.version === id, "recovery");
  await optional("ops/workflows/health/workflow-refresh.json", PipelineHealth, (value) => value.pipeline === "workflow-refresh" && [value.run_id, value.last_success?.run_id, value.last_failure?.run_id].includes(id), "health");
  return { release, records };
}

/** Public links use the host's configured data origin; never an invented store. */
export function publicRecordUrl(base: string, key: string): string | null {
  try {
    const origin = new URL(base.endsWith("/") ? base : `${base}/`);
    if (!["https:", "http:"].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash) return null;
    return new URL(key, origin).href;
  } catch { return null; }
}
