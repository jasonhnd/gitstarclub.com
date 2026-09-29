import { assertR2WriteDeployEnv, getR2KeyPrefix, type StorageReadDriver } from "@/lib/runtime-config";

export type BlobToR2SyncPlan = {
  execute: boolean;
  sourcePrefix: string;
  destinationPrefix: string;
  readDriver: StorageReadDriver;
};

export function assertBlobToR2SyncAllowed(
  args: { execute: boolean; env?: Record<string, string | undefined> },
): void {
  // Identity is checked again on the R2 store's put/del. The plan itself
  // refuses before any network call when DEPLOY_ENV cannot name a bucket.
  assertR2WriteDeployEnv(args.env);
}

export function describeBlobToR2SyncPlan(args: {
  execute?: boolean;
  sourcePrefix?: string;
  env?: Record<string, string | undefined>;
}): BlobToR2SyncPlan {
  const env = args.env;
  assertBlobToR2SyncAllowed({ execute: args.execute === true, env });
  return {
    execute: args.execute === true,
    sourcePrefix: args.sourcePrefix ?? "",
    destinationPrefix: getR2KeyPrefix(env),
    readDriver: "blob",
  };
}
