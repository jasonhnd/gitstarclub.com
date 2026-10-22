import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AggregateHistoryWorkerClient } from "./lib/aggregate-history-worker-client";

/** Read-only operator preflight; no source bundle, lease acquisition or write. */
export async function inspectPreviewAggregate(secretFile: string, generation: string, transport?: AggregateHistoryWorkerClient) {
  const client = transport ?? new AggregateHistoryWorkerClient({ origin: "https://pre.gitstarclub.com", generation, secret: readFileSync(secretFile, "utf8").trim() });
  const read = async (path: string) => {
    const value = await client.store.get(path);
    return value ? JSON.parse(value.body) : null;
  };
  const [lease, bootstrap, views] = await Promise.all([read("ops/workflows/active.json"), read("bootstrap/latest.json"), read("views/latest.json")]);
  const active = lease?.status === "running" && Date.parse(lease.expires_at) > Date.now();
  if (lease && (!["running", "published", "failed"].includes(lease.status) || !Number.isFinite(Date.parse(lease.expires_at)) || !Number.isInteger(lease.fencing_token))) throw new Error("Invalid preview lease");
  return { active, lease, bootstrap, views };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [secretFile, generation] = process.argv.slice(2);
  if (!secretFile || !generation) throw new Error("Usage: inspect-preview-aggregate.ts SECRET_FILE GENERATION");
  const state = await inspectPreviewAggregate(secretFile, generation);
  console.log(JSON.stringify(state, null, 2));
  if (state.active) process.exitCode = 1;
}
