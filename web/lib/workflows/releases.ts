import type { ZodType } from "zod";
import {
  Meta,
  MetadataBucketProgress,
  NonNegativeInt,
  RELEASE_RETENTION,
  RELEASES_PATH,
  ReleaseDataAsOf,
  ReleaseRecord,
  Releases,
  type PublishIntent,
} from "@/lib/contracts";
import { getWriteObjectStore, isObjectStoreConflict, type ObjectStore } from "@/lib/storage";
import { REPO_BUCKETS } from "./buckets";
import { renewWorkflowLease, type WorkflowOwnership } from "./lease";
import { metadataProgressPath } from "./steps/metadata";

async function readRequiredOrigin<T>(store: ObjectStore, path: string, schema: ZodType<T>): Promise<T> {
  const object = await (store.getOrigin ? store.getOrigin(path) : store.get(path));
  if (!object) throw new Error(`${path} missing`);
  return schema.parse(JSON.parse(object.body));
}

/** Require every completed bucket from the write origin; a missing audit ledger is never zero skips. */
export async function prepareReleaseRecord(
  intent: PublishIntent,
  store: ObjectStore = getWriteObjectStore(),
): Promise<ReleaseRecord> {
  const runId = intent.version;
  const meta = await readRequiredOrigin(store, `views/${runId}/meta.json`, Meta);
  let skipped = 0;
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    const progress = await readRequiredOrigin(store, metadataProgressPath(runId, bucket), MetadataBucketProgress);
    if (progress.bucket !== bucket || !progress.pending_pages || progress.pending_pages.length > 0 || !progress.skipped) {
      throw new Error(`release ${runId}: metadata bucket ${bucket} is incomplete or mismatched`);
    }
    skipped += progress.skipped.length;
  }
  const { seam_date, generated_at, backfilled_at, folded_through } = meta;
  return ReleaseRecord.parse({
    id: runId,
    published_at: intent.published_at,
    prev_version: intent.prev_version,
    tracked_repo_count: NonNegativeInt.parse(meta.active_repo_count),
    skipped_repo_count: skipped,
    data_as_of: ReleaseDataAsOf.parse({ seam_date, generated_at, backfilled_at, folded_through }),
  });
}

/** Origin reads and conditional writes prevent concurrent retries losing records. */
export async function appendReleaseRecord(
  owner: WorkflowOwnership,
  input: ReleaseRecord,
  store: ObjectStore = getWriteObjectStore(),
  ensureOwnership: () => Promise<unknown> = () => renewWorkflowLease(owner.runId, owner.fencingToken),
): Promise<void> {
  const record = ReleaseRecord.parse(input);
  if (record.id !== owner.runId) throw new Error("release id must match publication owner");
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await (store.getOrigin ? store.getOrigin(RELEASES_PATH) : store.get(RELEASES_PATH));
    const history = current ? Releases.parse(JSON.parse(current.body)) : Releases.parse({ schema_ver: 1, releases: [] });
    if (history.releases.some((existing) => existing.id === record.id)) return;
    if (current && !current.etag) throw new Error("release history has no origin ETag");
    const next = Releases.parse({
      schema_ver: 1,
      releases: [...history.releases, record]
        .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at) || a.id.localeCompare(b.id))
        .slice(0, RELEASE_RETENTION),
    });
    if (!next.releases.some((existing) => existing.id === record.id)) {
      throw new Error(`release ${record.id} falls outside the newest ${RELEASE_RETENTION} records`);
    }
    await ensureOwnership();
    try {
      await store.put(RELEASES_PATH, JSON.stringify(next), {
        contentType: "application/json",
        cacheControlMaxAge: 60,
        allowOverwrite: current !== null,
        ...(current ? { ifMatch: current.etag! } : {}),
      });
      return;
    } catch (error) {
      if (!isObjectStoreConflict(error)) throw error;
    }
  }
  throw new Error("release history conditional write exhausted retries");
}
