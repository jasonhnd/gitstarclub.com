import {
  assertR2WriteDeployEnv,
  assertR2WritesAllowed,
  BUCKET_IDENTITY_KEY,
  getR2AccessKeyId,
  getR2Bucket,
  getR2KeyPrefix,
  getR2PublicBaseUrl,
  getR2Region,
  getR2S3Endpoint,
  getR2SecretAccessKey,
  getStorageReadDriver,
  getStorageWriteDriver,
  type StorageReadDriver,
  type StorageWriteDriver,
} from "@/lib/runtime-config";
import { resolveRuntimeEnv } from "@/lib/workers-host/runtime-env";
import { DualReadObjectStore } from "./dual-read-store";
import { R2S3ObjectStore, type R2S3StoreConfig } from "./r2-s3-store";
import type { ObjectPutOptions, ObjectStore } from "./types";
import { VercelBlobObjectStore } from "./vercel-blob-store";

export type ObjectStoreFactoryEnv = Record<string, string | undefined>;

function factoryEnv(env?: ObjectStoreFactoryEnv): ObjectStoreFactoryEnv {
  return env ?? resolveRuntimeEnv();
}

export function createVercelBlobObjectStore(): ObjectStore {
  // Fetch/HTTP client — not `@vercel/blob` / undici. Required on
  // HOSTING_TARGET=cf so lease/write does not throw ALPNProtocols.
  return new VercelBlobObjectStore();
}

export function r2StoreConfigFromEnv(env?: ObjectStoreFactoryEnv): R2S3StoreConfig {
  const runtime = factoryEnv(env);
  const accessKeyId = getR2AccessKeyId(runtime);
  const secretAccessKey = getR2SecretAccessKey(runtime);
  const bucket = getR2Bucket(runtime);
  const endpoint = getR2S3Endpoint(runtime);
  if (!accessKeyId || !secretAccessKey || !bucket || !endpoint) {
    throw new Error(
      "R2 driver requires R2_ACCESS_KEY_ID (or AWS_ACCESS_KEY_ID), R2_SECRET_ACCESS_KEY (or AWS_SECRET_ACCESS_KEY), R2_BUCKET (or AWS_S3_BUCKET), and R2_S3_ENDPOINT or R2_ACCOUNT_ID",
    );
  }
  return {
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint,
    region: getR2Region(runtime),
    prefix: getR2KeyPrefix(runtime),
    publicBaseUrl: getR2PublicBaseUrl(runtime) || undefined,
  };
}

type PrefixedKeyStore = {
  physicalKey(path: string): string;
};

function isMetaNamespaceKey(key: string): boolean {
  const normalized = key.replace(/^\/+/, "");
  return normalized === "_meta" || normalized.startsWith("_meta/");
}

/**
 * `new URL()` removes `.` and `..` after one percent-decode, so
 * `views/../_meta/x` and `views/%2e%2e/_meta/x` both become `_meta/x`.
 * Reject those segments before the request is built.
 */
function hasDotSegment(key: string): boolean {
  for (const segment of key.replace(/^\/+/, "").split("/")) {
    if (segment === "." || segment === "..") return true;
    try {
      const decoded = decodeURIComponent(segment);
      if (decoded === "." || decoded === "..") return true;
    } catch {
      // A malformed escape is not a dot segment.
    }
  }
  return false;
}

function assertWritePathsAllowed(store: PrefixedKeyStore, paths: readonly string[]): void {
  for (const path of paths) {
    const physical = store.physicalKey(path);
    if (hasDotSegment(path) || hasDotSegment(physical)) {
      throw new Error('refusing R2 writes: path contains "." or ".." segments');
    }
    if (isMetaNamespaceKey(path) || isMetaNamespaceKey(physical)) {
      throw new Error("refusing R2 writes: keys under _meta/ are placed out of band");
    }
  }
}

function withBucketIdentityGuard<T extends ObjectStore & PrefixedKeyStore>(
  store: T,
  env: ObjectStoreFactoryEnv,
  bucket: string,
  endpoint: string,
  readIdentity: () => Promise<string | null>,
): ObjectStore {
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === "put") {
        return async (path: string, body: string | Uint8Array, options?: ObjectPutOptions) => {
          assertWritePathsAllowed(target, [path]);
          await assertR2WritesAllowed(env, readIdentity, bucket, endpoint);
          return target.put(path, body, options);
        };
      }
      if (prop === "del") {
        return async (paths: string | string[]) => {
          assertWritePathsAllowed(target, Array.isArray(paths) ? paths : [paths]);
          await assertR2WritesAllowed(env, readIdentity, bucket, endpoint);
          return target.del(paths);
        };
      }
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value === "function") return (value as (...args: unknown[]) => unknown).bind(target);
      return value;
    },
  });
}

async function readBucketIdentity(store: ObjectStore): Promise<string | null> {
  const result = await store.get(BUCKET_IDENTITY_KEY);
  return result?.body ?? null;
}

export function createR2S3ObjectStore(env?: ObjectStoreFactoryEnv, extras: Partial<R2S3StoreConfig> = {}): ObjectStore {
  const runtime = factoryEnv(env);
  const config = { ...r2StoreConfigFromEnv(runtime), ...extras };
  const store = new R2S3ObjectStore(config);
  // The marker identifies the bucket, not a key prefix, so it is read at the bucket root.
  const identityStore = config.prefix ? new R2S3ObjectStore({ ...config, prefix: "" }) : store;
  return withBucketIdentityGuard(store, runtime, config.bucket, config.endpoint, () =>
    readBucketIdentity(identityStore),
  );
}

export function createReadObjectStore(env?: ObjectStoreFactoryEnv): ObjectStore {
  const runtime = factoryEnv(env);
  const driver = getStorageReadDriver(runtime);
  switch (driver) {
    case "blob":
      return createVercelBlobObjectStore();
    case "r2":
      return createR2S3ObjectStore(runtime);
    case "r2_then_blob":
      return new DualReadObjectStore(createR2S3ObjectStore(runtime), createVercelBlobObjectStore());
    default: {
      const _exhaustive: never = driver;
      throw new Error(`unsupported storage read driver: ${String(_exhaustive)}`);
    }
  }
}

export function createWriteObjectStore(env?: ObjectStoreFactoryEnv): ObjectStore {
  const runtime = factoryEnv(env);
  const driver = getStorageWriteDriver(runtime);
  switch (driver) {
    case "blob":
      return createVercelBlobObjectStore();
    case "r2":
      assertR2WriteDeployEnv(runtime);
      return createR2S3ObjectStore(runtime);
    default: {
      const _exhaustive: never = driver;
      throw new Error(`unsupported storage write driver: ${String(_exhaustive)}`);
    }
  }
}

export function getReadObjectStore(env?: ObjectStoreFactoryEnv): ObjectStore {
  return createReadObjectStore(env);
}

export function getWriteObjectStore(env?: ObjectStoreFactoryEnv): ObjectStore {
  return createWriteObjectStore(env);
}

export function describeStorageDrivers(env?: ObjectStoreFactoryEnv): {
  read: StorageReadDriver;
  write: StorageWriteDriver;
} {
  return {
    read: getStorageReadDriver(env),
    write: getStorageWriteDriver(env),
  };
}
