import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { staticAssetsAdapter } from "@vinext/cloudflare/cache/static-assets-adapter";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { contentSecurityPolicyForEnvironment, securityHeaders } from "./lib/csp";
import { buildVars } from "./host-contract.mjs";
import { readPublication } from "./lib/workers-host/publication-fence";
import { writeCfBuildIdentity } from "./scripts/cf-build-identity";

const localModule = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig(async ({ mode }) => {
  const vars = buildVars(mode);
  Object.assign(process.env, vars);
  const commit = writeCfBuildIdentity();
  const base = "BLOB_BASE_URL" in vars ? vars.BLOB_BASE_URL : vars.R2_PUBLIC_BASE_URL;
  const publication = await readPublication(async (path) => {
    const response = await fetch(`${base}/${path}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Build publication read failed: ${response.status}`);
    return { body: await response.text(), etag: (response.headers.get("etag") ?? "missing").replace(/^"|"$/g, "") };
  });
  const snapshots = staticAssetsAdapter();
  return {
    plugins: [
      vinext({
        prerender: { routes: "*", concurrency: 2 },
        cache: {
          data: { adapter: localModule("./lib/workers-host/cache/data-adapter.ts") },
          cdn: { ...snapshots, adapter: localModule("./lib/workers-host/cache/page-adapter.ts"), options: { snapshotFence: publication.id },
            output: { async finalizePrerenderOutput(output) {
              await snapshots.output?.finalizePrerenderOutput?.(output);
              const manifest = JSON.parse(readFileSync(join(output.root, "dist/server/vinext-prerender.json"), "utf8")) as {
                routes: { status: string; path?: string; route: string; tags?: string[] }[];
              };
              const tags = Object.fromEntries(manifest.routes.filter((route) => route.status === "rendered")
                .map((route) => [route.path ?? route.route, route.tags ?? []]));
              const metadata = JSON.stringify({ mode, commit, publication: publication.id, tags });
              writeFileSync(join(output.root, "dist/server/gsc-host-build.json"), metadata);
              writeFileSync(join(output.clientOutDir, "_vinext/static-cache/gsc-host.json"), metadata);
              // Hashed build assets bypass the Worker; retain the same security
              // contract there without changing their immutable cache policy.
              const headerPath = join(output.clientOutDir, "_headers");
              const prior = existsSync(headerPath) ? readFileSync(headerPath, "utf8") : "";
              const headers = securityHeaders.map(({ key, value }) => `  ${key}: ${key === "Content-Security-Policy"
                ? contentSecurityPolicyForEnvironment("production") : value}`).join("\n");
              writeFileSync(headerPath, `${prior.trimEnd()}\n\n/*\n${headers}\n`);
            } } },
        },
      }),
      cloudflare({ viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] } }),
    ],
  };
});
