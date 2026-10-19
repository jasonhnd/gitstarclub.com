import { AsyncLocalStorage } from "node:async_hooks";

export type ProofContext = {
  env: Record<string, unknown>;
  status: string;
  layer?: string;
  offset: number;
  startedAt: number;
  path?: string;
  bypass?: boolean;
  revalidate?: number | false;
  cachedAt?: number;
};
export const proofContext = new AsyncLocalStorage<ProofContext>();
export const proofNow = () => Date.now() + (proofContext.getStore()?.offset ?? 0);
