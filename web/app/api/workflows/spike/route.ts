// SPIKE ONLY — triggers the spike workflow to confirm `start()` + the
// "use workflow" transform work end to end under Next 16. CRON_SECRET-gated so
// it isn't an open trigger. Delete once the real refresh workflow lands.
import { start } from "workflow/api";
import { spikeWorkflow } from "@/lib/workflows/spike";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const runId = `spike-${Date.now()}`;
  await start(spikeWorkflow, [runId]);
  return Response.json({ ok: true, runId });
}
