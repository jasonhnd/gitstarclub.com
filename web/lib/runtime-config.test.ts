import { afterEach, describe, expect, test } from "bun:test";
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
  test("resolves Blob base URL at call time and trims trailing slashes", () => {
    process.env.BLOB_BASE_URL = "https://one.example.com///";
    expect(getBlobBaseUrl()).toBe("https://one.example.com");

    process.env.BLOB_BASE_URL = "https://two.example.com/";
    expect(getBlobBaseUrl()).toBe("https://two.example.com");
  });

  test("falls back to NEXT_PUBLIC_BLOB_BASE_URL when the private base is absent", () => {
    delete process.env.BLOB_BASE_URL;
    process.env.NEXT_PUBLIC_BLOB_BASE_URL = "https://public.example.com/";

    expect(getBlobBaseUrl()).toBe("https://public.example.com");
  });

  test("required Blob base throws a clear config error", () => {
    delete process.env.BLOB_BASE_URL;
    delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;

    expect(() => requireBlobBaseUrl()).toThrow("BLOB_BASE_URL not set");
  });

  test("token getters resolve current env values without caching", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "blob-one";
    process.env.GITHUB_TOKEN = "github-one";
    expect(getBlobWriteToken()).toBe("blob-one");
    expect(getGithubToken()).toBe("github-one");

    process.env.BLOB_READ_WRITE_TOKEN = "blob-two";
    process.env.GITHUB_TOKEN = "github-two";
    expect(getBlobWriteToken()).toBe("blob-two");
    expect(getGithubToken()).toBe("github-two");
  });

  test("required token getters throw clear config errors", () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.GITHUB_TOKEN;

    expect(() => requireBlobWriteToken()).toThrow("BLOB_READ_WRITE_TOKEN not set");
    expect(() => requireGithubToken()).toThrow("GITHUB_TOKEN not set");
  });
});
