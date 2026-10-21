declare const __GSC_ASTRO_MODE__: "production" | "pre";

/** Unit tests default to the safe pre policy; built Workers bake an explicit mode. */
export const hostMode = typeof __GSC_ASTRO_MODE__ === "undefined" ? "pre" : __GSC_ASTRO_MODE__;
export const siteIndexable = hostMode === "production";
