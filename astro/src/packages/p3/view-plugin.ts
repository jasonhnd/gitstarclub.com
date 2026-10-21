import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const original = fileURLToPath(new URL("../../../../web/app/_localized/categories.tsx", import.meta.url));
const navigation = fileURLToPath(new URL("./navigation.ts", import.meta.url));
const routing = fileURLToPath(new URL("../../../../web/app/_localized/routing.ts", import.meta.url));
const webDirectory = fileURLToPath(new URL("../../../../web/app/_localized/", import.meta.url));

/** Reuse the original server view and translations without a second copy. */
export function adaptCategoryView(source: string): string {
  return source
    .replace('from "next/navigation"', `from ${JSON.stringify(navigation)}`)
    .replace(/^import \{ Chrome \} from .*;\n/m, "")
    .replace(/^\s*<Chrome [^\n]+\/>\n/gm, "\n")
    .replace(/from "\.\/([^"\n]+)"/g, (_, path: string) => `from ${JSON.stringify(path === "routing" ? `${routing}?astro-p3` : `${webDirectory}${path}`)}`);
}

/** Only this explicit import is adapted; every other web/package module is untouched. */
export function categoryViewPlugin(): Plugin {
  const id = `${original}?astro-p3`;
  return {
    name: "gitstarclub-category-server-view",
    enforce: "pre",
    resolveId(source) { if (source === "astro-p3:categories") return id; },
    load(source) { if (source === id) return adaptCategoryView(readFileSync(original, "utf8"));
      if (source === `${routing}?astro-p3`) return adaptCategoryView(readFileSync(routing, "utf8")); },
  };
}
