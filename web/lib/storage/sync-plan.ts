import { assertR2WritesAllowed, getR2KeyPrefix, isVercelProduction, type StorageReadDriver } from "@/lib/runtime-config";

export type BlobToR2SyncPlan = {
  execute: boolean;
  sourcePrefix: string;
  destinationPrefix: string;
  readDriver: StorageReadDriver;
};

export function assertBlobToR2SyncAllowed(
  args: { execute: boolean; env?: Record<string, string | undefined> },
): void {
  const env = args.env ?? process.env;
  if (isVercelProduction(env)) {
    throw new Error("refusing blob→R2 sync: VERCEL_ENV=production");
  }
  assertR2WritesAllowed(env);
}

export function describeBlobToR2SyncPlan(args: {
  execute?: boolean;
  sourcePrefix?: string;
  env?: Record<string, string | undefined>;
}): BlobToR2SyncPlan {
  const env = args.env ?? process.env;
  assertBlobToR2SyncAllowed({ execute: args.execute === true, env });
  return {
    execute: args.execute === true,
    sourcePrefix: args.sourcePrefix ?? "",
    destinationPrefix: getR2KeyPrefix(env),
    readDriver: "blob",
  };
}
