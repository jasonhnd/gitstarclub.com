import { AsyncLocalStorage } from "node:async_hooks";
import type { Publication } from "../publication-fence";

export type CacheScope = {
  path: string;
  bypass: boolean;
  startedAt: number;
  publication: Publication;
  checkPublication: () => Promise<Publication>;
  status: "BYPASS" | "MISS" | "HIT" | "SNAPSHOT" | "STALE";
};
export const cacheScope = new AsyncLocalStorage<CacheScope>();
