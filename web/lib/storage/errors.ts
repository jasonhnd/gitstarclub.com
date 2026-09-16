import { BlobPreconditionFailedError } from "@vercel/blob";

export class ObjectStorePreconditionFailedError extends Error {
  readonly status = 412;

  constructor(message = "object store precondition failed") {
    super(message);
    this.name = "ObjectStorePreconditionFailedError";
  }
}

export class ObjectStoreNotFoundError extends Error {
  readonly status = 404;

  constructor(message = "object store object not found") {
    super(message);
    this.name = "ObjectStoreNotFoundError";
  }
}

export function isObjectStoreConflict(error: unknown): boolean {
  if (error instanceof ObjectStorePreconditionFailedError) return true;
  if (error instanceof BlobPreconditionFailedError) return true;
  if (!(error instanceof Error)) return false;
  return /already exists|overwrite|precondition|conflict|409|412/i.test(`${error.name} ${error.message}`);
}
