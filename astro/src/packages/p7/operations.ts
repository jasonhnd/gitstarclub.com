import type { APIContext } from "astro";
import { runLiveRefreshRoute } from "../../../../web/lib/cron/handlers";
import { resolveWorkflowRuntime } from "../../../../web/lib/workflows/runtime/resolve";
import { runRefreshStepRoute } from "../../../../web/lib/workflows/runtime/step-route";
import { startRefreshWorkflowRoute } from "../../../../web/lib/workflows/start";
import { invalidatePublishedViews } from "../../../../web/lib/workflows/publication-cache";
import { resolveCacheInvalidation } from "../../../../web/lib/cache-invalidation";
import { requireBearerToken } from "../../../../web/lib/security";

// The workflow/data layer stays shared with web; only its framework boundary moves.
export { runLiveRefreshRoute, runRefreshStepRoute, startRefreshWorkflowRoute };
export { POST as rollback } from "../../../../web/app/api/workflows/refresh/rollback/route";

declare global {
  namespace App {
    interface Locals {
      cfContext: { waitUntil(pending: Promise<unknown>): void };
    }
  }
}

export type OperationContext = Pick<APIContext, "request"> & {
  locals: Pick<App.Locals, "invalidatePaths"> & {
    cfContext: { waitUntil(pending: Promise<unknown>): void };
  };
};

/** Keep deferred HTTP chain tasks alive after the route has returned its run ID. */
export function scheduleAfterResponse(context: OperationContext) {
  return (task: () => Promise<void>): void => {
    context.locals.cfContext.waitUntil(Promise.resolve().then(task));
  };
}

export async function start(context: OperationContext): Promise<Response> {
  return startRefreshWorkflowRoute(context.request, async (runId) => {
    const runtime = resolveWorkflowRuntime({
      requestUrl: context.request.url,
      schedule: scheduleAfterResponse(context),
    });
    await runtime.startRefresh(runId);
  });
}

export async function step(context: OperationContext): Promise<Response> {
  return runRefreshStepRoute(context.request, {
    requestUrl: context.request.url,
    schedule: scheduleAfterResponse(context),
  });
}

/** Auth first; invalidate pointer caches. HTML switches by publication namespace. */
export async function revalidate(
  context: Pick<OperationContext, "request"> & {
    locals: Pick<App.Locals, "invalidatePaths">;
  },
): Promise<Response> {
  const unauthorized = requireBearerToken(context.request.headers.get("authorization"));
  if (unauthorized) return unauthorized;
  const cache = resolveCacheInvalidation();
  await invalidatePublishedViews({
    revalidateTag: (tag, options) => cache.revalidateTag(tag, options),
    // Astro does not consume web framework path tags; all HTML is publication-keyed.
    revalidatePath: async () => {},
  });
  return Response.json({ ok: true });
}
