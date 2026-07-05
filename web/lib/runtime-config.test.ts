import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getBlobBaseUrl,
  getBlobWriteToken,
  getGithubToken,
  requireBlobBaseUrl,
  requireBlobWriteToken,
  requireGithubToken,
} from "./runtime-config";

const originalBlobBase = process.env.BLOB_BASE_URL;
const originalPublicBlobBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL;
const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
const originalGithubToken = process.env.GITHUB_TOKEN;

beforeEach(() => {
  delete process.env.BLOB_BASE_URL;
  delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.GITHUB_TOKEN;
});

afterEach(() => {
  if (originalBlobBase === undefined) delete process.env.BLOB_BASE_URL;
  else process.env.BLOB_BASE_URL = originalBlobBase;
  if (originalPublicBlobBase === undefined) delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  else process.env.NEXT_PUBLIC_BLOB_BASE_URL = originalPublicBlobBase;
  if (originalBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
  if (originalGithubToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalGithubToken;
});

describe("runtime config getters", () => {
  test("normalizes Blob base URL and falls back to the public var", () => {
    process.env.NEXT_PUBLIC_BLOB_BASE_URL = "https://public.example.com/";
    expect(getBlobBaseUrl()).toBe("https://public.example.com");

    process.env.BLOB_BASE_URL = "https://private.example.com///";
    expect(getBlobBaseUrl()).toBe("https://private.example.com");
  });

  test("reads Blob and GitHub tokens at call time", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "blob-a";
    process.env.GITHUB_TOKEN = "gh-a";
    expect(getBlobWriteToken()).toBe("blob-a");
    expect(getGithubToken()).toBe("gh-a");

    process.env.BLOB_READ_WRITE_TOKEN = "blob-b";
    process.env.GITHUB_TOKEN = "gh-b";
    expect(requireBlobWriteToken()).toBe("blob-b");
    expect(requireGithubToken()).toBe("gh-b");
  });

  test("required config helpers fail clearly when values are missing", () => {
    expect(() => requireBlobBaseUrl()).toThrow("BLOB_BASE_URL not set");
    expect(() => requireBlobWriteToken()).toThrow("BLOB_READ_WRITE_TOKEN not set");
    expect(() => requireGithubToken()).toThrow("GITHUB_TOKEN not set");
  });
});
