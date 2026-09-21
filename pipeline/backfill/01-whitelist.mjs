// Backfill step 1 — whitelist: repos with stars >= 10,000 → data/whitelist.json.
// Input to BigQuery extract (02) + metadata (03). Needs GITHUB_TOKEN.
// Run (from pipeline/):  GITHUB_TOKEN=... node backfill/01-whitelist.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveMinTrackedStars } from "../../web/lib/constants.mjs";
import { searchWhitelist } from "../lib/github.mjs";

const dataDir = fileURLToPath(new URL("../data", import.meta.url));
const minStars = resolveMinTrackedStars(process.env.MIN_TRACKED_STARS);

const list = await searchWhitelist(minStars);
mkdirSync(dataDir, { recursive: true });
writeFileSync(`${dataDir}/whitelist.json`, JSON.stringify(list));

console.log(`whitelist: ${list.length} repos >= ${minStars}★ → data/whitelist.json`);
if (list.length) {
  console.log(`  top: ${list[0].full_name} (${list[0].stars.toLocaleString()}★)`);
}
