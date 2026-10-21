import { ArtifactStore, type CacheKV } from "./store";
import { workerBindings } from "../runtime-env";
import type { CacheInvalidationPort, RevalidateType } from "../../cache-invalidation/types";

const encodeTag = (tag: string) => tag.replace(/[^\t\x20-\x7e]+/g, (run) => encodeURIComponent(run));
/** Awaited platform-native invalidation also works outside a framework fetch lifecycle. */
export class WorkerCacheInvalidation implements CacheInvalidationPort {
  private stores(): ArtifactStore[] {
    const env = workerBindings();
    if (!env.GSC_CACHE) throw new Error("Cache invalidation requires GSC_CACHE");
    return ["data", "pages"].map((layer) => new ArtifactStore(env.GSC_CACHE as CacheKV, `gsc:${env.DEPLOY_ENV}:${layer}:v1`));
  }
  async revalidateTag(tag: string): Promise<void> {
    for (const store of this.stores()) await store.revalidateTag(encodeTag(tag));
  }
  async revalidatePath(path: string, type?: RevalidateType): Promise<void> {
    const stem = path === "/" && type ? "" : path.replace(/\/$/, "") || "/";
    await this.revalidateTag(`_N_T_${stem}${type ? `/${type}` : ""}`);
  }
}
