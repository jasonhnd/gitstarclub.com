import { createOgHarfbuzzPlugin } from "../../../../web/node_modules/vinext/dist/plugins/og-harfbuzz.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The existing card JSX stays shared. Worker builds need precompiled Wasm and
// the packaged fallback font instead of the Node implementation's dynamic Wasm.
const edge = fileURLToPath(new URL("../../../../web/node_modules/@vercel/og/dist/index.edge.js", import.meta.url));
export function rankingImages() {
  const harfbuzz = createOgHarfbuzzPlugin();
  const configure = harfbuzz.configResolved;
  harfbuzz.configResolved = (config) => configure({ ...config, root: process.env.KANBAN_TMP });
  return [harfbuzz, {
    name: "p1-ranking-images",
    enforce: "pre",
    resolveId(source) { if (source === "next/og") return edge; },
    transform(source, id) {
      if (id !== edge) return;
      const font = readFileSync(new URL("../../../../web/node_modules/@vercel/og/dist/Geist-Regular.ttf", import.meta.url)).toString("base64");
      const pattern = /fetch\(\s*new URL\("\.\/Geist-Regular\.ttf", import\.meta\.url\)\s*\)\.then\(\(res\) => res\.arrayBuffer\(\)\)/;
      if (!pattern.test(source)) throw new Error("Ranking image font loader changed; check the pinned renderer");
      return { code: source.replace(pattern, `Promise.resolve(Uint8Array.from(atob(${JSON.stringify(font)}), (char) => char.charCodeAt(0)).buffer)`), map: null };
    },
  }];
}
