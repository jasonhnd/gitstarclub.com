import app from "../../../web/lib/workers-host/vinext-app";
import type { WorkerEnv } from "./env";

type WorkerContext = { waitUntil(promise: Promise<unknown>): void };
export function handleNextRequest(request: Request, env: WorkerEnv, ctx: WorkerContext): Promise<Response> | Response {
  return app.fetch(request, env, ctx);
}
