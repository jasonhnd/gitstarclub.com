export function getBlobBaseUrl(): string {
  return (process.env.BLOB_BASE_URL ?? process.env.NEXT_PUBLIC_BLOB_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

export function requireBlobBaseUrl(): string {
  const base = getBlobBaseUrl();
  if (!base) throw new Error("BLOB_BASE_URL not set — point it at the Vercel Blob store base URL.");
  return base;
}

export function getBlobWriteToken(): string | null {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() || null;
}

export function requireBlobWriteToken(): string {
  const token = getBlobWriteToken();
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN not set");
  return token;
}

export function getGithubToken(): string | null {
  return process.env.GITHUB_TOKEN?.trim() || null;
}

export function requireGithubToken(): string {
  const token = getGithubToken();
  if (!token) throw new Error("GITHUB_TOKEN not set");
  return token;
}
