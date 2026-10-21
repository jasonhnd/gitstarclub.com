import { z } from "zod";
import {
  PublicationPostCommitError,
  PublicationPostCommitLeaseLostError,
  publishVersionWithDeps,
  type PublicationResult,
} from "@/lib/workflows/publication-core";
import { productionPublicationDeps } from "@/lib/workflows/publication-deps";
import { readAuthoritativeView, readView } from "@/lib/data/source";
import { submitIndexNowUrls, workflowPublishCanonicalPaths } from "@/lib/indexnow";
import { sanitizeErrorText } from "@/lib/observability/sanitize-error";
import { WorkflowLeaseOwnershipError } from "../lease";
import { putOwnedView } from "../owned-write";
import type { RefreshCursor } from "../runtime/types";

const PublishProgress = z.object({
  publication: z.object({ version: z.string(), prev_version: z.string().nullable(), published_at: z.string() }),
  // null means derivation failed: retain the existing best-effort, all-or-nothing notification.
  paths: z.array(z.string()).nullable(),
});
const progressPath = (runId: string, page: number) => `ops/workflows/${runId}/publish/progress-${page}.json`;

async function postCommit<T>(runId: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof WorkflowLeaseOwnershipError) throw new PublicationPostCommitLeaseLostError(runId, error);
    throw new PublicationPostCommitError(runId, "indexnow", error);
  }
}

async function derivePaths(publication: PublicationResult, dimension: "repo" | "org"): Promise<string[] | null> {
  try {
    return await workflowPublishCanonicalPaths({
      runId: publication.version, prevVersion: publication.prev_version, publishedAt: publication.published_at,
      reader: async <T>(version: string, rel: string, schema: z.ZodType<T>): Promise<T | null> => {
        // Each pass uses the original selector, comparing only one entity kind.
        // Suppressing the other lookup omits that kind's entity reads entirely;
        // unioning both passes reproduces the unsliced candidate set.
        if (rel === `lookup/${dimension === "repo" ? "orgs" : "repos"}.json`) return null;
        return readView(`views/${version}/${rel}`, schema, { bust: version });
      },
    });
  } catch (error) {
    console.warn("[indexnow]", "workflow publish derivation failed", {
      source: "workflow-publish", runId: publication.version,
      error: sanitizeErrorText(error instanceof Error ? error.message : String(error)),
    });
    return null;
  }
}

/** Retained serial caller; the Worker runtime uses runPublishStep below. */
export async function publishVersion(runId: string, fencingToken: number): Promise<PublicationResult> {
  return publishVersionWithDeps(runId, fencingToken, productionPublicationDeps);
}

// Publish step: persist the original rollback target before the atomic pointer
// switch, then derive IndexNow candidates in two fresh invocations. Progress
// pins the original publication metadata and each predecessor's paths; a replay
// never repoints the version or changes the notification candidate limits.
export async function runPublishStep(
  runId: string,
  fencingToken: number,
  cursor: RefreshCursor = {},
): Promise<PublicationResult & { nextWorkOffset?: number }> {
  const owner = { runId, fencingToken };
  const page = cursor.workOffset ?? 0;
  const run = async () => {
    await productionPublicationDeps.ensureOwnership(owner);
    if (!Number.isInteger(page) || page < 0 || page > 2) throw new Error(`invalid publish page ${page}`);
    const existing = await readAuthoritativeView(progressPath(runId, page), PublishProgress, { bust: runId });
    if (existing) {
      if (existing.publication.version !== runId) throw new Error(`publish page ${page}: mismatched publication`);
      return { ...existing.publication, ...(page < 2 ? { nextWorkOffset: page + 1 } : {}) };
    }

    if (page === 0) {
      const publication = await publishVersionWithDeps(runId, fencingToken, {
        ...productionPublicationDeps, notifyIndexNow: async () => null,
      });
      await postCommit(runId, () => putOwnedView(owner, progressPath(runId, 0), { publication, paths: [] }));
      return { ...publication, nextWorkOffset: 1 };
    }

    const previous = await readAuthoritativeView(progressPath(runId, page - 1), PublishProgress, { bust: runId });
    if (!previous || previous.publication.version !== runId) throw new Error(`publish page ${page}: missing predecessor checkpoint`);
    const derived = previous.paths === null ? null : await derivePaths(previous.publication, page === 1 ? "repo" : "org");
    const paths = derived === null ? null : [...new Set([...(previous.paths ?? []), ...derived])].sort((a, b) => a.localeCompare(b));
    await productionPublicationDeps.ensureOwnership(owner);
    if (page === 2 && paths !== null) {
      await submitIndexNowUrls(paths, { source: "workflow-publish", runId });
    }
    await putOwnedView(owner, progressPath(runId, page), { publication: previous.publication, paths });
    return { ...previous.publication, ...(page < 2 ? { nextWorkOffset: page + 1 } : {}) };
  };
  return page === 0 ? run() : postCommit(runId, run);
}
