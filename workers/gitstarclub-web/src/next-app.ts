import nextApp from "../../../web/.open-next/worker.js";
import type { WorkerEnv } from "./env";

type WorkerContext = {
  waitUntil(promise: Promise<unknown>): void;
};

export function handleNextRequest(request: Request, env: WorkerEnv, ctx: WorkerContext): Promise<Response> | Response {
  return nextApp.fetch(request, env, ctx);
}
