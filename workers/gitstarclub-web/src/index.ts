import { isWorkerShellRequest } from "../../../web/lib/workers-host/shell-routes";
import type { RefreshJob, WorkerEnv } from "./env";
import { handleNextRequest } from "./next-app";
import { emitRunLog, handleQueue, handleScheduled, handleShellFetch } from "./shell";

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    const url = new URL(request.url);
    if (isWorkerShellRequest(url.pathname, request.method)) {
      return handleShellFetch(request, env);
    }
    emitRunLog({ event: "host.next", path: url.pathname, method: request.method });
    return handleNextRequest(request, env, ctx);
  },

  async scheduled(event: ScheduledEvent, env: WorkerEnv): Promise<void> {
    await handleScheduled(event, env);
  },

  async queue(batch: { messages: Array<{ body: RefreshJob }> }, env: WorkerEnv): Promise<void> {
    await handleQueue(batch, env);
  },
};
