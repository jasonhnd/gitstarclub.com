import { runWithCloudflareWorkersHostForTests as withCloudflareReadPolicy } from "../../../../web/lib/runtime-config";
import { withWorkerEnv, workerBindings } from "../../../../web/lib/workers-host/runtime-env";

// Existing view readers retain pointer, overlay, history and schema selection.
// Only their HTTP transport changes to the same request's native DATA binding.
export const PUBLISHED_READ_ORIGIN = "https://astro-published-data.invalid";
export function withPublishedReads<T>(run: () => T): T {
  const bindings = workerBindings();
  if (!bindings.DATA) return run();
  return withCloudflareReadPolicy(true, () => withWorkerEnv({
    ...bindings,
    STORAGE_READ_DRIVER: "r2",
    R2_PUBLIC_BASE_URL: PUBLISHED_READ_ORIGIN,
    VIEWS_VERSION_FALLBACK: "",
  }, run));
}
