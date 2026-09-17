import { describe, expect, test } from "bun:test";
import {
  OPENTELEMETRY_API_CJS_ENTRY,
  isOpentelemetryApiPackage,
  rewriteOpentelemetryApiPackageJson,
} from "./opentelemetry-api-package";

const fixture = {
  name: "@opentelemetry/api",
  main: "./build/src/index.js",
  module: "./build/esm/index.js",
  esnext: "./build/esnext/index.js",
  exports: {
    ".": {
      esnext: "./build/esnext/index.js",
      module: "./build/esm/index.js",
      types: "./build/src/index.d.ts",
      default: "./build/src/index.js",
    },
  },
};

describe("rewriteOpentelemetryApiPackageJson", () => {
  test("points module and esnext at the NFT-traced CJS entry", () => {
    const rewritten = JSON.parse(rewriteOpentelemetryApiPackageJson(JSON.stringify(fixture))) as typeof fixture;
    expect(rewritten.module).toBe(OPENTELEMETRY_API_CJS_ENTRY);
    expect(rewritten.esnext).toBe(OPENTELEMETRY_API_CJS_ENTRY);
    expect(rewritten.exports["."].module).toBe(OPENTELEMETRY_API_CJS_ENTRY);
    expect(rewritten.exports["."].esnext).toBe(OPENTELEMETRY_API_CJS_ENTRY);
    expect(rewritten.exports["."].default).toBe("./build/src/index.js");
  });

  test("refuses to rewrite a different package", () => {
    expect(() => rewriteOpentelemetryApiPackageJson(JSON.stringify({ name: "left-pad" }))).toThrow("left-pad");
    expect(isOpentelemetryApiPackage({ name: "@opentelemetry/api" })).toBe(true);
    expect(isOpentelemetryApiPackage({ name: "next" })).toBe(false);
  });
});
