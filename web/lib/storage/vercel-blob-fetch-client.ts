import { getBlobBaseUrl } from "@/lib/runtime-config";

export const VERCEL_BLOB_API_URL = "https://vercel.com/api/blob";
export const VERCEL_BLOB_API_VERSION = "12";

export type VercelBlobFetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type VercelBlobFetchClientOptions = {
  fetch?: VercelBlobFetchImpl;
  apiUrl?: string;
  publicBaseUrl?: string;
  now?: () => number;
};

/**
 * Named like the official SDK errors so `VercelBlobObjectStore` can map them
 * without importing `@vercel/blob` (that package's undici transport sets
 * `ALPNProtocols`, which Cloudflare workerd rejects).
 */
export class BlobFetchPreconditionFailedError extends Error {
  constructor(message = "Precondition failed: ETag mismatch.") {
    super(message);
    this.name = "BlobPreconditionFailedError";
  }
}

export class BlobFetchNotFoundError extends Error {
  constructor(message = "The requested blob does not exist") {
    super(message);
    this.name = "BlobNotFoundError";
  }
}

export function parseVercelBlobStoreId(token: string): string {
  const parts = token.split("_");
  const storeId = parts[3] ?? "";
  if (!storeId) throw new Error("Invalid BLOB_READ_WRITE_TOKEN: unable to extract store ID");
  return storeId;
}

export function vercelBlobPublicUrl(pathname: string, token: string, publicBaseUrl?: string): string {
  const base = (publicBaseUrl ?? getBlobBaseUrl()).replace(/\/+$/, "");
  const path = pathname.replace(/^\/+/, "");
  if (base) return `${base}/${path}`;
  return `https://${parseVercelBlobStoreId(token)}.public.blob.vercel-storage.com/${path}`;
}

/** Store-owner origin hostname. Public CDN GET cannot fence lease CAS (#402 / #475 / #500). */
export function vercelBlobOriginUrl(pathname: string, token: string): string {
  const path = pathname.replace(/^\/+/, "");
  return `https://${parseVercelBlobStoreId(token)}.private.blob.vercel-storage.com/${path}`;
}

export function vercelBlobReadUrl(
  pathname: string,
  token: string,
  access: "public" | "private",
  publicBaseUrl?: string,
): string {
  switch (access) {
    case "public":
      return vercelBlobPublicUrl(pathname, token, publicBaseUrl);
    case "private": {
      const url = new URL(vercelBlobOriginUrl(pathname, token));
      // Same bust the official SDK uses for private + useCache:false.
      url.searchParams.set("cache", "0");
      return url.toString();
    }
    default: {
      const _exhaustive: never = access;
      throw new Error(`unsupported blob access: ${String(_exhaustive)}`);
    }
  }
}

function assertNoNodeTlsOptions(init: RequestInit): void {
  const record = init as RequestInit & { ALPNProtocols?: unknown; dispatcher?: unknown };
  if (record.ALPNProtocols !== undefined || record.dispatcher !== undefined) {
    throw new Error("refusing Blob fetch init that sets ALPNProtocols/dispatcher (not implemented on Cloudflare Workers)");
  }
}

function headerRecord(init?: HeadersInit): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!init) return headers;
  if (init instanceof Headers) {
    init.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }
  if (Array.isArray(init)) {
    for (const [key, value] of init) headers[key] = value;
    return headers;
  }
  return { ...init };
}

async function readApiError(response: Response): Promise<{ code?: string; message?: string }> {
  try {
    const data = (await response.json()) as { error?: { code?: string; message?: string } };
    return { code: data.error?.code, message: data.error?.message };
  } catch {
    return {};
  }
}

function throwApiFailure(response: Response, code: string | undefined, message: string | undefined): never {
  if (response.status === 412 || code === "precondition_failed") {
    throw new BlobFetchPreconditionFailedError(message);
  }
  if (response.status === 404 || code === "not_found") {
    throw new BlobFetchNotFoundError(message);
  }
  throw new Error(`Vercel Blob API ${response.status}${message ? `: ${message}` : ""}`);
}

export type VercelBlobFetchPutOptions = {
  access: "public" | "private";
  token?: string;
  allowOverwrite?: boolean;
  addRandomSuffix?: boolean;
  contentType?: string;
  cacheControlMaxAge?: number;
  ifMatch?: string;
};

export type VercelBlobFetchTokenOptions = {
  token?: string;
};

export function createVercelBlobFetchClient(options: VercelBlobFetchClientOptions = {}) {
  const apiUrl = (options.apiUrl ?? VERCEL_BLOB_API_URL).replace(/\/+$/, "");
  const now = options.now ?? Date.now;

  const fetchImpl = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    assertNoNodeTlsOptions(init);
    const fetcher = options.fetch ?? ((url, requestInit) => globalThis.fetch(url, requestInit));
    return fetcher(input, init);
  };

  const apiHeaders = (token: string, extra: Record<string, string> = {}): Record<string, string> => ({
    authorization: `Bearer ${token}`,
    "x-api-version": VERCEL_BLOB_API_VERSION,
    "x-vercel-blob-store-id": parseVercelBlobStoreId(token),
    "x-api-blob-request-id": `${parseVercelBlobStoreId(token)}:${now()}:${Math.random().toString(16).slice(2)}`,
    "x-api-blob-request-attempt": "0",
    ...extra,
  });

  async function requestApi<T>(token: string, pathname: string, init: RequestInit): Promise<T> {
    const response = await fetchImpl(`${apiUrl}${pathname}`, {
      ...init,
      headers: apiHeaders(token, headerRecord(init.headers)),
    });
    if (response.ok) return (await response.json()) as T;
    const { code, message } = await readApiError(response);
    throwApiFailure(response, code, message);
  }

  return {
    async put(path: string, body: string | Uint8Array, putOptions: VercelBlobFetchPutOptions) {
      const token = putOptions.token ?? "";
      const headers: Record<string, string> = {
        "x-vercel-blob-access": putOptions.access,
        "x-add-random-suffix": putOptions.addRandomSuffix ? "1" : "0",
        "x-allow-overwrite": putOptions.allowOverwrite === false ? "0" : "1",
      };
      if (putOptions.contentType) {
        headers["x-content-type"] = putOptions.contentType;
        headers["content-type"] = putOptions.contentType;
      }
      if (putOptions.cacheControlMaxAge !== undefined) {
        headers["x-cache-control-max-age"] = String(putOptions.cacheControlMaxAge);
      }
      if (putOptions.ifMatch) headers["x-if-match"] = putOptions.ifMatch;
      const params = new URLSearchParams({ pathname: path });
      const written = await requestApi<{ etag: string; url: string }>(token, `/?${params.toString()}`, {
        method: "PUT",
        headers,
        body: body as BodyInit,
      });
      return { etag: written.etag, url: written.url };
    },

    async get(path: string, getOptions: VercelBlobFetchTokenOptions & { access: "public" | "private" }) {
      const token = getOptions.token ?? "";
      const url = vercelBlobReadUrl(path, token, getOptions.access, options.publicBaseUrl);
      const init: RequestInit & { cf?: { cacheTtl: number; cacheEverything: boolean } } = {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
        // Workers fetch cache otherwise honors the Blob CDN Cache-Control and
        // can replay a stale ETag into lease ifMatch (see lease renew / #402).
        cf: { cacheTtl: 0, cacheEverything: false },
      };
      const response = await fetchImpl(url, init);
      if (response.status === 404) return null;
      if (!response.ok || !response.body) {
        throw new Error(`Failed to fetch blob: ${response.status} ${response.statusText}`);
      }
      const contentLength = response.headers.get("content-length");
      return {
        statusCode: 200 as const,
        stream: response.body,
        headers: response.headers,
        blob: {
          etag: response.headers.get("etag") || "",
          contentType: response.headers.get("content-type") || "application/octet-stream",
          size: contentLength ? Number(contentLength) : 0,
        },
      };
    },

    async head(path: string, headOptions: VercelBlobFetchTokenOptions) {
      const token = headOptions.token ?? "";
      const params = new URLSearchParams({ url: path });
      return requestApi<{
        etag: string;
        contentType: string;
        size: number;
        url: string;
      }>(token, `?${params.toString()}`, { method: "GET" });
    },

    async list(
      listOptions: VercelBlobFetchTokenOptions & {
        prefix?: string;
        cursor?: string;
        limit?: number;
        mode?: "expanded" | "folded";
      },
    ) {
      const token = listOptions.token ?? "";
      const params = new URLSearchParams();
      if (listOptions.limit) params.set("limit", String(listOptions.limit));
      if (listOptions.prefix) params.set("prefix", listOptions.prefix);
      if (listOptions.cursor) params.set("cursor", listOptions.cursor);
      if (listOptions.mode) params.set("mode", listOptions.mode);
      const result = await requestApi<{
        blobs: Array<{ pathname: string; url: string; size: number; etag?: string }>;
        folders?: string[];
        cursor?: string;
        hasMore: boolean;
      }>(token, `?${params.toString()}`, { method: "GET" });
      return {
        blobs: result.blobs,
        folders: result.folders ?? [],
        cursor: result.cursor,
        hasMore: result.hasMore,
      };
    },

    async del(pathsOrUrls: string | string[], delOptions?: VercelBlobFetchTokenOptions) {
      const token = delOptions?.token ?? "";
      const urls = Array.isArray(pathsOrUrls) ? pathsOrUrls : [pathsOrUrls];
      await requestApi(token, "/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls }),
      });
    },
  };
}
