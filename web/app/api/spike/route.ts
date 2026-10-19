import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { invalidatePublishedViews } from "@/lib/workflows/publication-cache";
import { corePublicationRevalidatePaths } from "@/lib/data/core-revalidate-paths";
import { invalidatePublishedVersionMemo } from "@/lib/data/source";
import { proofContext } from "../../../spike/context";

export const dynamic = "force-dynamic";

// Local proof controls only. Never include this route in the migration.
export async function POST(request: Request) {
  const input = await request.json();
  if (input.action === "evict-hot" || input.action === "clear") {
    const kv = proofContext.getStore()!.env.GSC_CACHE as any;
    let cursor: string | undefined;
    let count = 0;
    do {
      const page = await kv.list({ cursor });
      for (const key of page.keys) {
        if (key.name.startsWith("gsc-0074:pages:v1:entry:")) {
          const id = key.name.split(":").at(-1);
          await caches.default.delete("https://gsc-0074-cache.invalid/" + id);
          count++;
        }
        if (input.action === "clear") await kv.delete(key.name);
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    invalidatePublishedVersionMemo();
    return Response.json({ action: input.action, count });
  }
  if (input.action === "publish" || input.action === "rollback") {
    await fetch("http://127.0.0.1:4074/__control", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: input.action === "publish" ? "run-b" : "run-a" }),
    });
    const ops: unknown[] = [];
    await invalidatePublishedViews({
      async revalidateTag(tag, options) { ops.push({ tag, options }); await revalidateTag(tag, options); },
      async revalidatePath(path) { ops.push({ path }); await revalidatePath(path); },
    });
    return Response.json({ action: input.action, ops, corePaths: corePublicationRevalidatePaths().length });
  }
  if (input.action === "path") {
    await revalidatePath(input.path);
    return Response.json({ invalidated: input.path });
  }
  if (input.action === "tag") {
    await revalidateTag("spike-data", { expire: 0 });
    return Response.json({ invalidated: "spike-data" });
  }
  return new Response(null, { status: 400 });
}

const tagged = unstable_cache(async () => ({ renderedAt: Date.now() }), ["spike-data"], {
  tags: ["spike-data"], revalidate: 604800,
});
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.has("diag")) {
    try {
      const response = await fetch("http://127.0.0.1:4074/views/latest.json", { cache: "no-store" });
      return Response.json({ status: response.status, body: await response.text() });
    } catch (error) {
      return Response.json({ error: String(error), stack: (error as Error).stack });
    }
  }
  return Response.json(await tagged());
}
