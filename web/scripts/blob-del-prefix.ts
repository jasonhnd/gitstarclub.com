// Recoverable Blob prefix cleanup. Always inventories first and previews exact
// object/byte totals. Deletion requires BOTH --execute and --confirm <prefix>.
// Shared protection logic with automated version GC blocks production state.
//
// Preview:
//   bun scripts/blob-del-prefix.ts views/verify-123/
// Execute the exact previewed prefix:
//   bun scripts/blob-del-prefix.ts views/verify-123/ --execute --confirm views/verify-123/
import { del, get, list } from "@vercel/blob";
import {
  BootstrapPublicationPointer,
  ViewsPointer,
  WorkflowLease,
  type BootstrapPublicationPointer as BootstrapPointerType,
  type ViewsPointer as ViewsPointerType,
  type WorkflowLease as WorkflowLeaseType,
} from "@/lib/contracts";
import {
  assertBlobDeletionAllowed,
  executeBlobDeletionPlan,
  planBlobPrefixDeletion,
  type BlobDeletionContext,
} from "@/lib/blob-deletion";
import type { ZodType } from "zod";

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const args = process.argv.slice(2);
const prefix = args[0];
const execute = args.includes("--execute");
const confirmIndex = args.indexOf("--confirm");
const confirmation = confirmIndex >= 0 ? args[confirmIndex + 1] : undefined;

if (!TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN not set");
  process.exit(1);
}
if (!prefix || prefix.startsWith("--")) {
  console.error("usage: bun scripts/blob-del-prefix.ts <specific-prefix/> [--execute --confirm <same-prefix/>]");
  process.exit(1);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson<T>(path: string, schema: ZodType<T>): Promise<T | null> {
  const result = await get(path, { access: "public", token: TOKEN });
  if (!result) return null;
  if (result.statusCode !== 200 || !result.stream) throw new Error(`Blob read ${path} -> ${result.statusCode}`);
  return schema.parse(JSON.parse(await new Response(result.stream).text()));
}

async function protectionContext(): Promise<BlobDeletionContext> {
  const [views, bootstrap, active] = await Promise.all([
    readJson<ViewsPointerType>("views/latest.json", ViewsPointer),
    readJson<BootstrapPointerType>("bootstrap/latest.json", BootstrapPublicationPointer),
    readJson<WorkflowLeaseType>("ops/workflows/active.json", WorkflowLease),
  ]);
  const activeWorkflowRun =
    active?.status === "running" && Date.parse(active.expires_at) > Date.now() ? active.run_id : null;
  return {
    currentViewVersion: views?.version,
    rollbackViewVersion: views?.prev_version,
    activeWorkflowRun,
    currentBootstrapGeneration: bootstrap?.generation,
    rollbackBootstrapGeneration: bootstrap?.previous_generation,
  };
}

async function deleteUrls(urls: string[]): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await del(urls, { token: TOKEN });
      await sleep(250);
      return;
    } catch (error) {
      const retryAfter = (error as { retryAfter?: number })?.retryAfter;
      if (retryAfter && attempt < 5) {
        console.log(`rate-limited, waiting ${retryAfter}s…`);
        await sleep((retryAfter + 1) * 1000);
        continue;
      }
      throw error;
    }
  }
}

try {
  const context = await protectionContext();
  const plan = await planBlobPrefixDeletion(prefix, context, ({ prefix: listedPrefix, cursor, limit }) =>
    list({ prefix: listedPrefix, cursor, limit, token: TOKEN }),
  );
  console.log(`preview: prefix="${plan.prefix}" objects=${plan.objectCount} bytes=${plan.totalBytes}`);
  for (const blob of plan.objects.slice(0, 20)) console.log(`  ${blob.pathname} (${blob.size} bytes)`);
  if (plan.objects.length > 20) console.log(`  … ${plan.objects.length - 20} more object(s)`);

  if (!execute) {
    console.log("dry-run: nothing deleted.");
    console.log(`execute: --execute --confirm ${plan.prefix}`);
    process.exit(0);
  }
  if (confirmation !== plan.prefix) {
    throw new Error(`--confirm must exactly equal "${plan.prefix}"`);
  }

  // Resolve protection state again immediately before the first destructive call.
  assertBlobDeletionAllowed(plan.prefix, await protectionContext());
  const deleted = await executeBlobDeletionPlan(plan, confirmation, deleteUrls);
  console.log(`done: deleted ${deleted} objects (${plan.totalBytes} bytes) under "${plan.prefix}"`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
