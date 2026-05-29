// Backfill step 1 — whitelist: repos with stars >= 10,000 → data/whitelist.json.
// Input to BigQuery extract (02) + metadata (03). Needs GITHUB_TOKEN.
// Run (from pipeline/):  GITHUB_TOKEN=... node backfill/01-whitelist.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { searchWhitelist } from "../lib/github.mjs";

const MIN_STARS = 10000;
const dataDir = fileURLToPath(new URL("../data", import.meta.url));

const list = await searchWhitelist(MIN_STARS);
mkdirSync(dataDir, { recursive: true });
writeFileSync(`${dataDir}/whitelist.json`, JSON.stringify(list));

console.log(`whitelist: ${list.length} repos >= ${MIN_STARS}★ → data/whitelist.json`);
if (list.length) {
  console.log(`  top: ${list[0].full_name} (${list[0].stars.toLocaleString()}★)`);
}
