import {
  assertR2WritesAllowed,
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
import { DualReadObjectStore } from "./dual-read-store";
import { R2S3ObjectStore, type R2S3StoreConfig } from "./r2-s3-store";
import type { ObjectStore } from "./types";
import { VercelBlobObjectStore } from "./vercel-blob-store";

export type ObjectStoreFactoryEnv = Record<string, string | undefined>;

export function createVercelBlobObjectStore(): ObjectStore {
  // Fetch/HTTP client — not `@vercel/blob` / undici. Required on
  // HOSTING_TARGET=cf so lease/write does not throw ALPNProtocols.
  return new VercelBlobObjectStore();
}

export function r2StoreConfigFromEnv(env: ObjectStoreFactoryEnv = process.env): R2S3StoreConfig {
  const accessKeyId = getR2AccessKeyId(env);
  const secretAccessKey = getR2SecretAccessKey(env);
  const bucket = getR2Bucket(env);
  const endpoint = getR2S3Endpoint(env);
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
    region: getR2Region(env),
    prefix: getR2KeyPrefix(env),
    publicBaseUrl: getR2PublicBaseUrl(env) || undefined,
  };
}

export function createR2S3ObjectStore(env: ObjectStoreFactoryEnv = process.env, extras: Partial<R2S3StoreConfig> = {}): ObjectStore {
  return new R2S3ObjectStore({ ...r2StoreConfigFromEnv(env), ...extras });
}

export function createReadObjectStore(env: ObjectStoreFactoryEnv = process.env): ObjectStore {
  const driver = getStorageReadDriver(env);
  switch (driver) {
    case "blob":
      return createVercelBlobObjectStore();
    case "r2":
      return createR2S3ObjectStore(env);
    case "r2_then_blob":
      return new DualReadObjectStore(createR2S3ObjectStore(env), createVercelBlobObjectStore());
    default: {
      const _exhaustive: never = driver;
      throw new Error(`unsupported storage read driver: ${String(_exhaustive)}`);
    }
  }
}

export function createWriteObjectStore(env: ObjectStoreFactoryEnv = process.env): ObjectStore {
  const driver = getStorageWriteDriver(env);
  switch (driver) {
    case "blob":
      return createVercelBlobObjectStore();
    case "r2":
      assertR2WritesAllowed(env);
      return createR2S3ObjectStore(env);
    default: {
      const _exhaustive: never = driver;
      throw new Error(`unsupported storage write driver: ${String(_exhaustive)}`);
    }
  }
}

export function getReadObjectStore(env: ObjectStoreFactoryEnv = process.env): ObjectStore {
  return createReadObjectStore(env);
}

export function getWriteObjectStore(env: ObjectStoreFactoryEnv = process.env): ObjectStore {
  return createWriteObjectStore(env);
}

export function describeStorageDrivers(env: ObjectStoreFactoryEnv = process.env): {
  read: StorageReadDriver;
  write: StorageWriteDriver;
} {
  return {
    read: getStorageReadDriver(env),
    write: getStorageWriteDriver(env),
  };
}
