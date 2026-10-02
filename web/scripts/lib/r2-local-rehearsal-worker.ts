// Standalone local Worker: imports the application read/write paths unchanged.
// This entrypoint is bundled only by the offline rehearsal, never deployed.
import { commitInitialBootstrapWithLease } from "../../../pipeline/lib/bootstrap-publication.mjs";
import { RankList } from "../../lib/contracts";
import { resolveBootstrapBaseBlobPath } from "../../lib/data/bootstrap-publication";
import { readView } from "../../lib/data/source";
import { createObjectStoreBootstrapAdapter } from "../../lib/storage/bootstrap-adapter";
import { ObjectStorePreconditionFailedError } from "../../lib/storage/errors";
import { createWriteObjectStore, describeStorageDrivers } from "../../lib/storage/object-store";
import type { R2Bucket } from "../../lib/storage/r2-binding-store";
import {
  BlobWorkflowLeaseStore,
  WorkflowLeaseWriteCache,
  claimWorkflowLease,
  releaseWorkflowLease,
  renewWorkflowLease,
} from "../../lib/workflows/lease";

type Env = Record<string, unknown> & { DATA: R2Bucket };
type Input = {
  generation: string;
  runId: string;
  fencingToken: number;
  at: string;
  etag: string;
  body: string;
  race?: boolean;
};

const worker = {
  async fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    // This is OpenNext's actual context symbol. The driver resolves DATA from it.
    (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("__cloudflare-context__")] = { env, ctx, cf: {} };
    try {
      const input = await request.json() as Input;
      const path = new URL(request.url).pathname;
      const objects = createWriteObjectStore();
      const leases = new BlobWorkflowLeaseStore(new WorkflowLeaseWriteCache(Date.now, 0), objects);
      let result: unknown;
      switch (path) {
        case "/rank": {
          const logical = "rank/month/2026-07/repo/flow.json";
          result = {
            drivers: describeStorageDrivers(),
            managedPointer: await objects.head("views/latest.json"),
            resolvedPath: await resolveBootstrapBaseBlobPath(logical),
            rank: await readView(logical, RankList, { base: true, skipNextDataCache: true }),
          };
          break;
        }
        case "/claim":
          result = await claimWorkflowLease({
            runId: input.runId,
            acquiredAt: input.at,
            idempotencyKey: input.runId,
            trigger: "r2-local-rehearsal",
          }, leases);
          break;
        case "/renew":
          result = await renewWorkflowLease(input.runId, input.fencingToken, leases, input.at);
          break;
        case "/release":
          result = await releaseWorkflowLease(input.runId, "published", leases, input.at, input.fencingToken);
          break;
        case "/cas":
          result = await objects.put("bootstrap/latest.json", input.body, { ifMatch: input.etag });
          break;
        case "/guard":
          result = await objects.put("ops/rehearsal-guard.json", "{}");
          break;
        case "/initial": {
          const store = createObjectStoreBootstrapAdapter(objects);
          if (input.race) {
            // Plant a local marker during renewal; all IO and conditions still
            // use the real binding. This reproduces the issue 573 race window.
            const read = store.readSnapshot.bind(store);
            let activeReads = 0;
            store.readSnapshot = async (key) => {
              if (key === "ops/workflows/active.json" && ++activeReads === 2) {
                await env.DATA.put("views/latest.json", "{}");
              }
              return read(key);
            };
          }
          result = await commitInitialBootstrapWithLease({ generation: input.generation, store, now: () => new Date().toISOString() });
          break;
        }
        default:
          return Response.json({ error: "unknown rehearsal operation" }, { status: 404 });
      }
      return Response.json(result);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, {
        status: error instanceof ObjectStorePreconditionFailedError ? 412 : 409,
      });
    }
  },
};

export default worker;
