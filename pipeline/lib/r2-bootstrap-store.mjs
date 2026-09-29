import { encodeS3Path, signS3Request } from "./s3-sign.mjs";

export const BUCKET_IDENTITY_KEY = "_meta/bucket-identity.json";

function toBuffer(body) {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  return Buffer.from(body);
}

function normalizeKey(path) {
  const normalized = String(path ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("://")) throw new Error(`invalid object path "${path}"`);
  for (const segment of normalized.split("/")) {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      // A malformed escape is not a dot segment.
    }
    if (segment === "." || segment === ".." || decoded === "." || decoded === "..") {
      throw new Error('refusing R2 writes: path contains "." or ".." segments');
    }
  }
  return normalized;
}

function isMetaKey(key) {
  return key === "_meta" || key.startsWith("_meta/");
}

function expectedDeployEnv(target) {
  return target === "prod" ? "production" : "pre";
}

export function createR2BootstrapStore(config) {
  const accessKeyId = config?.accessKeyId;
  const secretAccessKey = config?.secretAccessKey;
  const bucket = config?.bucket;
  const endpoint = String(config?.endpoint ?? "").replace(/\/+$/, "");
  const region = config?.region || "auto";
  const target = config?.target;
  const fetchImpl = config?.fetch ?? globalThis.fetch;
  const now = config?.now ?? (() => new Date());
  if (!accessKeyId || !secretAccessKey || !bucket || !endpoint) {
    throw new Error("R2 store requires an access key, a secret, a bucket, and an endpoint");
  }
  if (target !== "prod" && target !== "pre") throw new Error("--target must be prod or pre");

  let identityOk = false;

  async function request(method, key, options = {}) {
    const hasBody = method !== "GET" && method !== "HEAD" && method !== "DELETE";
    const body = hasBody ? toBuffer(options.body ?? Buffer.alloc(0)) : undefined;
    const url = new URL(`${endpoint}/${bucket}${key ? `/${encodeS3Path(key)}` : ""}`);
    const headers = {};
    if (options.contentType) headers["content-type"] = options.contentType;
    if (options.cacheControl) headers["cache-control"] = options.cacheControl;
    if (options.ifMatch) headers["if-match"] = options.ifMatch;
    if (options.ifNoneMatch) headers["if-none-match"] = options.ifNoneMatch;
    const signed = signS3Request({
      method,
      url,
      headers,
      body,
      accessKeyId,
      secretAccessKey,
      region,
      now: now(),
    });
    const response = await fetchImpl(url, { method, headers: signed, body });
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      status: response.status,
      body: bytes,
      etag: response.headers.get("etag"),
    };
  }

  async function readKey(key) {
    const response = await request("GET", key);
    if (response.status === 404) return { body: null, etag: null };
    if (response.status !== 200) throw new Error(`R2 read ${key} -> ${response.status}`);
    return { body: response.body, etag: response.etag };
  }

  async function ensureIdentity() {
    if (identityOk) return;
    let response;
    try {
      response = await request("GET", BUCKET_IDENTITY_KEY);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`refusing R2 writes: bucket identity marker is unreadable (${message})`);
    }
    if (response.status === 404 || response.body.byteLength === 0) {
      throw new Error("refusing R2 writes: bucket identity marker is missing");
    }
    if (response.status !== 200) {
      throw new Error(`refusing R2 writes: bucket identity marker is unreadable (${response.status})`);
    }
    let identity;
    try {
      identity = JSON.parse(response.body.toString("utf8"));
    } catch {
      throw new Error("refusing R2 writes: bucket identity marker is unreadable (not JSON)");
    }
    if (!identity || typeof identity !== "object" || typeof identity.bucket !== "string") {
      throw new Error("refusing R2 writes: bucket identity marker is unreadable (bucket is missing)");
    }
    if (identity.bucket !== bucket) {
      throw new Error(
        `refusing R2 writes: bucket identity bucket "${identity.bucket}" does not match target "${bucket}"`,
      );
    }
    const expected = expectedDeployEnv(target);
    if (identity.deploy_env !== expected) {
      throw new Error(
        `refusing R2 writes: bucket identity deploy_env=${identity.deploy_env} does not match --target ${target} (expected ${expected})`,
      );
    }
    identityOk = true;
  }

  async function writableKey(path) {
    const key = normalizeKey(path);
    if (isMetaKey(key)) throw new Error("refusing R2 writes: keys under _meta/ are placed out of band");
    await ensureIdentity();
    return key;
  }

  function conflict(status) {
    return status === 412 || status === 409;
  }

  return {
    async read(path) {
      return (await readKey(normalizeKey(path))).body;
    },
    async readSnapshot(path) {
      return readKey(normalizeKey(path));
    },
    async checkIdentity() {
      await ensureIdentity();
    },
    async create(path, body, contentType = "application/octet-stream") {
      const key = await writableKey(path);
      const response = await request("PUT", key, {
        body,
        contentType,
        cacheControl: "public, max-age=31536000",
        ifNoneMatch: "*",
      });
      if (conflict(response.status)) return false;
      if (response.status !== 200 && response.status !== 201) throw new Error(`R2 create ${key} -> ${response.status}`);
      return true;
    },
    async createMutable(path, body, contentType = "application/json") {
      const key = await writableKey(path);
      const response = await request("PUT", key, {
        body,
        contentType,
        cacheControl: "public, max-age=60",
        ifNoneMatch: "*",
      });
      if (conflict(response.status)) return false;
      if (response.status !== 200 && response.status !== 201) {
        throw new Error(`R2 create ${key} -> ${response.status}`);
      }
      return true;
    },
    async compareAndSet(path, etag, body, contentType = "application/json") {
      if (typeof etag !== "string" || etag.trim() === "") {
        throw new Error("R2 compare-and-set requires a non-empty etag");
      }
      const key = await writableKey(path);
      const response = await request("PUT", key, {
        body,
        contentType,
        cacheControl: "public, max-age=60",
        ifMatch: etag,
      });
      if (conflict(response.status)) return false;
      if (response.status !== 200 && response.status !== 201) {
        throw new Error(`R2 compare-and-set ${key} -> ${response.status}`);
      }
      return true;
    },
    async put(path, body, contentType = "application/json") {
      const key = await writableKey(path);
      const response = await request("PUT", key, {
        body,
        contentType,
        cacheControl: "public, max-age=60",
      });
      if (response.status !== 200 && response.status !== 201) throw new Error(`R2 put ${key} -> ${response.status}`);
    },
    async delete(path) {
      const key = await writableKey(path);
      const response = await request("DELETE", key);
      if (response.status !== 200 && response.status !== 204 && response.status !== 404) {
        throw new Error(`R2 delete ${key} -> ${response.status}`);
      }
    },
  };
}
