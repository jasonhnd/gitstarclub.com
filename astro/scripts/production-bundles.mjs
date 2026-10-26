import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** Astro defaults server minification off after merging the top-level config. */
export function productionBundles(scratch) {
  return {
    name: "gsc-production-bundles",
    apply: "build",
    enforce: "post",
    configEnvironment() { return { build: { minify: "oxc" } }; },
    generateBundle(_options, bundle) {
      const environment = this.environment;
      assert.ok(environment.config.build.minify, `${environment.name} must be minified`);
      const modules = Object.values(bundle).filter((item) => item.type === "chunk").flatMap((item) => Object.keys(item.modules));
      const reactRoots = [...new Set(modules.flatMap((id) => id.match(/^(.*\/node_modules\/react)\//)?.[1] ?? []))];
      const domRoots = [...new Set(modules.flatMap((id) => id.match(/^(.*\/node_modules\/react-dom)\//)?.[1] ?? []))];
      if (environment.name === "client") {
        assert.ok(reactRoots.length <= 1 && domRoots.length <= 1, "Duplicate React copies in client islands");
        for (const id of modules) assert.doesNotMatch(id, /(?:react[^/]*\/.*\.development\.|react-refresh\/|jsx-dev-runtime)/, `Development React shipped: ${id}`);
      }
      writeFileSync(resolve(scratch, `bundles-${environment.name}.json`), JSON.stringify({
        environment: environment.name, minify: environment.config.build.minify,
        reactRoots, domRoots, modules,
        chunks: Object.values(bundle).filter((item) => item.type === "chunk").map((item) => ({ file: item.fileName, bytes: Buffer.byteLength(item.code) })),
      }, null, 2) + "\n");
    },
  };
}
