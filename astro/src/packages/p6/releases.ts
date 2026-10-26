import { RELEASES_PATH, Releases, type ReleaseRecord, type Releases as ReleaseHistory } from "@/lib/contracts";

export type ReleaseReader = {
  raw<T>(key: string, schema: { parse(value: unknown): T }): Promise<T | null>;
};

/** Public history is a flat key, not a version-relative view. Absence is empty, not an error. */
export function readReleaseHistory(data: ReleaseReader): Promise<ReleaseHistory | null> {
  return data.raw(RELEASES_PATH, Releases);
}

/** Match the publisher: newest publication time, then id ascending. */
export function releasesNewestFirst(history: ReleaseHistory): ReleaseRecord[] {
  return [...history.releases].sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at) || a.id.localeCompare(b.id));
}

export function findRelease(history: ReleaseHistory | null, id: string): ReleaseRecord | null {
  if (!history) return null;
  return history.releases.find((record) => record.id === id) ?? null;
}

export function releasePath(id: string): string {
  return `/releases/${encodeURIComponent(id)}`;
}
