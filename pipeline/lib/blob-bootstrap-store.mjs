import { BlobPreconditionFailedError, get, put } from "@vercel/blob";

function isConflict(error) {
  if (error instanceof BlobPreconditionFailedError) return true;
  if (!(error instanceof Error)) return false;
  return /already exists|overwrite|precondition|conflict|409|412/i.test(`${error.name} ${error.message}`);
}

export function createBlobBootstrapStore(token) {
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN not set");
  return {
    async read(path) {
      const result = await get(path, { access: "public", token });
      if (!result) return null;
      if (result.statusCode !== 200 || !result.stream) throw new Error(`Blob read ${path} -> ${result.statusCode}`);
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    },
    async create(path, body, contentType = "application/octet-stream") {
      try {
        await put(path, body, {
          access: "public",
          token,
          allowOverwrite: false,
          addRandomSuffix: false,
          contentType,
          cacheControlMaxAge: 31536000,
        });
        return true;
      } catch (error) {
        if (isConflict(error)) return false;
        throw error;
      }
    },
    async readSnapshot(path) {
      const result = await get(path, { access: "public", token });
      if (!result) return { body: null, etag: null };
      if (result.statusCode !== 200 || !result.stream) throw new Error(`Blob read ${path} -> ${result.statusCode}`);
      return {
        body: Buffer.from(await new Response(result.stream).arrayBuffer()),
        etag: result.blob.etag,
      };
    },
    async createMutable(path, body, contentType = "application/json") {
      try {
        await put(path, body, {
          access: "public",
          token,
          allowOverwrite: false,
          addRandomSuffix: false,
          contentType,
          cacheControlMaxAge: 60,
        });
        return true;
      } catch (error) {
        if (isConflict(error)) return false;
        throw error;
      }
    },
    async compareAndSet(path, etag, body, contentType = "application/json") {
      try {
        await put(path, body, {
          access: "public",
          token,
          allowOverwrite: true,
          addRandomSuffix: false,
          contentType,
          cacheControlMaxAge: 60,
          ifMatch: etag,
        });
        return true;
      } catch (error) {
        if (isConflict(error)) return false;
        throw error;
      }
    },
    async put(path, body, contentType = "application/json") {
      await put(path, body, {
        access: "public",
        token,
        allowOverwrite: true,
        addRandomSuffix: false,
        contentType,
        cacheControlMaxAge: 60,
      });
    },
  };
}
