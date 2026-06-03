import { generateObject } from "ai";
import { z } from "zod";
import { readView } from "@/lib/data/source";
import { putView } from "@/lib/data/write";
import { Meta, RankList, ReposLookup, Narrative } from "@/lib/contracts";
import { narrativePrompt, type NarrativeInput } from "../narrative-context";
import { monthLabel } from "@/lib/format";
import { sendAlert } from "@/lib/observability/alert";

// Best-effort monthly narrative (v0.2 §2). After publish, generate a bilingual blurb for the
// latest folded month and write flat narrative/<period>.json. Idempotent (a closed month's
// narrative is immutable → skip if present). NEVER throws: a model/auth failure leaves the
// published version untouched and the page simply renders nothing. Auth via Vercel AI Gateway
// (VERCEL_OIDC_TOKEN on Vercel / AI_GATEWAY_API_KEY locally). See VERCEL-DATA-OPERATIONS §3.

const MODEL = "anthropic/claude-haiku-4-5";

export async function generateNarrative(runId: string): Promise<{ ok: boolean; period?: string; skipped?: boolean; error?: string }> {
  "use step";
  try {
    const meta = await readView(`views/${runId}/meta.json`, Meta, { bust: runId });
    const period = meta?.folded_through?.month;
    if (!period) return { ok: true, skipped: true };

    const existing = await readView(`narrative/${period}.json`, Narrative, { bust: runId }).catch(() => null);
    if (existing) return { ok: true, period, skipped: true };

    const [flow, growth, newc, lookup] = await Promise.all([
      readView(`views/${runId}/rank/month/${period}/repo/flow.json`, RankList, { bust: runId }),
      readView(`views/${runId}/rank/month/${period}/repo/growth.json`, RankList, { bust: runId }).catch(() => null),
      readView(`views/${runId}/rank/month/${period}/repo/new.json`, RankList, { bust: runId }).catch(() => null),
      readView(`views/${runId}/lookup/repos.json`, ReposLookup, { bust: runId }),
    ]);
    if (!flow || !lookup) return { ok: true, period, skipped: true };

    const name = (id: number | undefined) => (id != null ? lookup[String(id)]?.full_name ?? String(id) : "");
    const input: NarrativeInput = {
      label: `${monthLabel("en", Number(period.slice(5, 7)), "long")} ${period.slice(0, 4)}`,
      topGainers: flow.items.slice(0, 5).map((it) => ({ full_name: name(it.id), gained: it.value })),
      fastest: (growth?.items ?? []).slice(0, 3).map((it) => ({ full_name: name(it.id), rate: Math.round(it.rate ?? 0) })),
      newcomers: (newc?.items ?? []).slice(0, 5).map((it) => name(it.id)).filter(Boolean),
    };

    const { object } = await generateObject({
      model: MODEL,
      schema: z.object({ en: z.string(), zh: z.string() }),
      prompt: narrativePrompt(input),
    });

    const narrative = Narrative.parse({
      period,
      generated_at: new Date().toISOString(),
      model: MODEL,
      en: object.en.trim(),
      zh: object.zh.trim(),
    });
    await putView(`narrative/${period}.json`, narrative);
    return { ok: true, period };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await sendAlert({ pipeline: "workflow-refresh", title: "narrative generation failed (best-effort)", run_id: runId, step: "narrative", error });
    return { ok: false, error };
  }
}
