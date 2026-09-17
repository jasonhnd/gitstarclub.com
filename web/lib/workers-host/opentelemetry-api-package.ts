/**
 * OpenNext's Node middleware bundler (Next 16 `proxy.ts`) uses esbuild with
 * `conditions: ["module"]` and `mainFields: ["module", "main"]`.
 *
 * `@opentelemetry/api` is a direct app dependency (next/cache graph). NFT only
 * traces the CJS `build/src` tree, so the copied package.json still points
 * `module` / `esnext` at missing `build/esm` files and the Worker build fails.
 *
 * Point those fields at the traced CJS entry. Vercel `next build` is unchanged
 * unless this rewrite is applied first (only `cf:build` does that).
 */
export const OPENTELEMETRY_API_CJS_ENTRY = "./build/src/index.js";

type PackageExports = {
  "."?: Record<string, unknown>;
} & Record<string, unknown>;

type OtelPackageJson = {
  name?: string;
  module?: string;
  esnext?: string;
  exports?: PackageExports;
};

export function isOpentelemetryApiPackage(pkg: { name?: string }): boolean {
  return pkg.name === "@opentelemetry/api";
}

export function rewriteOpentelemetryApiPackageJson(raw: string): string {
  const pkg = JSON.parse(raw) as OtelPackageJson;
  if (!isOpentelemetryApiPackage(pkg)) {
    throw new Error(`refusing to rewrite package.json for ${pkg.name ?? "(missing name)"}`);
  }

  const nextExports: PackageExports = { ...(pkg.exports ?? {}) };
  const rootExport = typeof nextExports["."] === "object" && nextExports["."] !== null ? { ...nextExports["."] } : {};
  rootExport.module = OPENTELEMETRY_API_CJS_ENTRY;
  rootExport.esnext = OPENTELEMETRY_API_CJS_ENTRY;
  nextExports["."] = rootExport;

  return `${JSON.stringify(
    {
      ...pkg,
      module: OPENTELEMETRY_API_CJS_ENTRY,
      esnext: OPENTELEMETRY_API_CJS_ENTRY,
      exports: nextExports,
    },
    null,
    2,
  )}\n`;
}
