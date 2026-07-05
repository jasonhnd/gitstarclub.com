// Runtime configuration boundary for server-side data and workflow modules.
// Keep process.env reads here so tests and route handlers can change config
// without relying on module reloads.

type RuntimeEnv = Record<string, string | undefined>;

export function getBlobBaseUrl(env: RuntimeEnv = process.env): string {
  return (env.BLOB_BASE_URL ?? env.NEXT_PUBLIC_BLOB_BASE_URL ?? "").replace(/\/+$/, "");
}

export function requireBlobBaseUrl(env?: RuntimeEnv): string {
  const value = getBlobBaseUrl(env);
  if (!value) throw new Error("BLOB_BASE_URL not set — point it at the Vercel Blob store base URL.");
  return value;
}

export function getBlobWriteToken(env: RuntimeEnv = process.env): string | undefined {
  return env.BLOB_READ_WRITE_TOKEN || undefined;
}

export function requireBlobWriteToken(env?: RuntimeEnv): string {
  const value = getBlobWriteToken(env);
  if (!value) throw new Error("BLOB_READ_WRITE_TOKEN not set");
  return value;
}

export function getGithubToken(env: RuntimeEnv = process.env): string | undefined {
  return env.GITHUB_TOKEN || undefined;
}

export function requireGithubToken(env?: RuntimeEnv): string {
  const value = getGithubToken(env);
  if (!value) throw new Error("GITHUB_TOKEN not set");
  return value;
}
