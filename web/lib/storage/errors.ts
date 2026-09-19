export class ObjectStorePreconditionFailedError extends Error {
  readonly status = 412;

  constructor(message = "object store precondition failed") {
    super(message);
    this.name = "ObjectStorePreconditionFailedError";
  }
}

function isNamedError(error: unknown, name: string): boolean {
  return error instanceof Error && error.name === name;
}

export function isObjectStoreConflict(error: unknown): boolean {
  if (error instanceof ObjectStorePreconditionFailedError) return true;
  if (isNamedError(error, "BlobPreconditionFailedError")) return true;
  if (!(error instanceof Error)) return false;
  return /already exists|overwrite|precondition|conflict|409|412/i.test(`${error.name} ${error.message}`);
}
