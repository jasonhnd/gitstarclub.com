// Runtime configuration boundary for server-side data and workflow modules.
// Keep environment reads here so tests and serverless invocations observe the current process.env.

export function getBlobBaseUrl(): string {
  return (process.env.BLOB_BASE_URL ?? process.env.NEXT_PUBLIC_BLOB_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

export function requireBlobBaseUrl(): string {
  const value = getBlobBaseUrl();
  if (!value) throw new Error("BLOB_BASE_URL not set - point it at the Vercel Blob store base URL.");
  return value;
}

export function getBlobWriteToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() || undefined;
}

export function requireBlobWriteToken(): string {
  const value = getBlobWriteToken();
  if (!value) throw new Error("BLOB_READ_WRITE_TOKEN not set");
  return value;
}

export function getGithubToken(): string | undefined {
  return process.env.GITHUB_TOKEN?.trim() || undefined;
}

export function requireGithubToken(): string {
  const value = getGithubToken();
  if (!value) throw new Error("GITHUB_TOKEN not set");
  return value;
}
