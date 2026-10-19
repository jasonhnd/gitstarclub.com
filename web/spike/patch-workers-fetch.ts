import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

// vinext 1.2.1 preserves force-cache after implementing its semantics, but
// workerd rejects that RequestInit value. Keep vinext's data-cache decisions;
// normalize only the options forwarded to native Request/fetch.
const file = "node_modules/vinext/dist/shims/fetch-cache.js";
const original = readFileSync(file, "utf8");
const marker = "// GSC_0074_NATIVE_CACHE_NORMALIZATION";
if (!original.includes(marker)) {
  const needle = "function stripNextFromInit(init, cacheOverride) {\n\tif (!init)";
  const replacement = `function stripNextFromInit(init, cacheOverride) {
  ${marker}
  if (cacheOverride !== undefined && !["no-store", "no-cache"].includes(cacheOverride)) {
    cacheOverride = undefined;
    if (init) { const { cache: _nativeCache, ...rest } = init; init = rest; }
  }
\tif (!init)`;
  assert(original.includes(needle), "Pinned vinext fetch shim changed; inspect before patching");
  writeFileSync(file, original.replace(needle, replacement));
}
console.log("Pinned vinext native Request cache normalization applied; framework cache semantics retained.");
