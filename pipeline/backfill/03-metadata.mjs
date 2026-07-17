// Backfill step 3 — metadata: GraphQL → repos dimension (data/repos.json).
// Needs GITHUB_TOKEN + data/whitelist.json (step 01). Milestones (crossed_*) are
// added later by step 04 (DuckDB cumsum). See docs/DATA-CONTRACTS.md §1.2.
// Run (from pipeline/):  GITHUB_TOKEN=... node backfill/03-metadata.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { batchMetadata } from "../lib/github.mjs";

const dataDir = fileURLToPath(new URL("../data", import.meta.url));
const whitelist = JSON.parse(readFileSync(`${dataDir}/whitelist.json`, "utf8"));

const meta = await batchMetadata(whitelist.map((r) => r.node_id));

const repos = [];
const missing = [];
for (const r of whitelist) {
  const m = meta.get(r.id);
  if (!m) {
    missing.push(`${r.full_name} (${r.id})`);
    continue;
  }
  repos.push({
    id: r.id,
    node_id: r.node_id,
    owner: m.owner,
    owner_type: m.owner_type, // "User" | "Organization"
    name: m.name,
    full_name: m.full_name,
    description: m.description,
    language: m.language,
    topics: m.topics,
    created_at: m.created_at,
    current_stars: m.current_stars, // GraphQL authoritative
    active: true,
    tracked_since: null,
    is_archived: m.is_archived,
    fetched_at: new Date().toISOString(),
  });
}

if (missing.length > 0) {
  throw new Error(
    `GraphQL metadata missing for ${missing.length} active repository(s): ${missing.slice(0, 5).join(", ")}`,
  );
}

writeFileSync(`${dataDir}/repos.json`, JSON.stringify(repos));
console.log(`metadata: ${repos.length}/${whitelist.length} repos → data/repos.json`);
