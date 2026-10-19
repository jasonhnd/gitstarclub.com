import { AsyncLocalStorage } from "node:async_hooks";

export type RuntimeEnv = Record<string, string | undefined>;
const bindings = new AsyncLocalStorage<Record<string, unknown>>();
let testReader: (() => Record<string, unknown>) | undefined;

/** The native Worker passes its bindings at every fetch, queue and scheduled boundary. */
export function withWorkerEnv<T>(env: object, run: () => T): T {
  return bindings.run(env as Record<string, unknown>, run);
}

export function workerBindings(): Record<string, unknown> {
  return testReader ? testReader() : bindings.getStore() ?? {};
}

/** Local tools have no Worker bindings; tests may inject them without module mocks. */
export function setWorkerBindingReaderForTests(reader?: () => Record<string, unknown>): void {
  testReader = reader;
}

export function workerStringEnv(env: Record<string, unknown>): RuntimeEnv {
  const out: RuntimeEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * Prefer request-scoped native bindings over the process fallback. Never copy
 * secrets into process.env: concurrent requests and local tools stay isolated.
 */
export function resolveRuntimeEnv(fallback: RuntimeEnv = process.env): RuntimeEnv {
  try {
    return { ...fallback, ...workerStringEnv(workerBindings()) };
  } catch {
    return fallback;
  }
}
