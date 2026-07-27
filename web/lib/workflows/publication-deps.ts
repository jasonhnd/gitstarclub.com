import {
  PublishIntent,
  ViewsPointer,
  WhitelistSnapshot,
} from "@/lib/contracts";
import { readAuthoritativeView } from "@/lib/data/source";
import { createView, putView } from "@/lib/data/write";
import { submitWorkflowPublishIndexNow } from "@/lib/indexnow";
import { renewWorkflowLease } from "@/lib/workflows/lease";
import type { PublicationDeps } from "@/lib/workflows/publication-core";
import { requestPublishedViewsInvalidation } from "@/lib/workflows/publication-invalidation-request";

export const productionPublicationDeps: PublicationDeps = {
  readPointer: () => readAuthoritativeView("views/latest.json", ViewsPointer),
  readIntent: (operationId) =>
    readAuthoritativeView(`ops/workflows/${operationId}/publish-intent.json`, PublishIntent),
  createIntent: (operationId, intent) => createView(`ops/workflows/${operationId}/publish-intent.json`, intent),
  readWhitelistSnapshot: (runId) =>
    readAuthoritativeView(`canonical/v2/whitelist/${runId}.json`, WhitelistSnapshot),
  writePointer: (pointer) => putView("views/latest.json", pointer),
  writeRecovery: (recovery) => putView("ops/workflows/latest-success.json", recovery),
  writeWhitelistPointer: (pointer) => putView("canonical/v2/whitelist/latest.json", pointer),
  ensureOwnership: (owner) => renewWorkflowLease(owner.runId, owner.fencingToken).then(() => undefined),
  invalidate: requestPublishedViewsInvalidation,
  notifyIndexNow: submitWorkflowPublishIndexNow,
  now: () => new Date().toISOString(),
};
