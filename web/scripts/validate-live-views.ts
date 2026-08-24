// Validates daily live JSON views on Vercel Blob after cron runs.
// Run from web/:
//   bun scripts/validate-live-views.ts [cacheBust]
//   bun scripts/validate-live-views.ts --bust 2026-05-31

import { fileURLToPath } from "node:url";
import type { ZodType } from "zod";
import {
  CurrentMonthDocument,
  CurrentMonthShard,
  HotSnapshot,
  LiveGenerationPointer,
} from "../lib/contracts/index";
import { assembleCurrentMonth, currentMonthShardPath, isCurrentMonthIndex } from "../lib/data/current-month-shards";
import type { RankItem } from "../lib/contracts/index";
import { loadWebEnvFiles, warnEnvFileDiagnostic } from "./lib/env";

const BLOB_BASE_KEYS = ["BLOB_BASE_URL", "NEXT_PUBLIC_BLOB_BASE_URL"] as const;
const webDir = fileURLToPath(new URL("..", import.meta.url));

type BlobBaseKey = (typeof BLOB_BASE_KEYS)[number];
type JsonObject = Record<string, unknown>;

type ViewResult =
  | ({ ok: true; path: string; status: number; notFound: false } & JsonObject)
  | {
      ok: false;
      path: string;
      status?: number;
      notFound: boolean;
      error: string;
      issues?: string[];
    };

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function usage(): void {
  console.log(
    [
      "Usage: bun scripts/validate-live-views.ts [cacheBust]",
      "       bun scripts/validate-live-views.ts --bust 2026-05-31",
      "",
      "Reads BLOB_BASE_URL or NEXT_PUBLIC_BLOB_BASE_URL, also from web/.env.local when present.",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): string {
  let bust: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (arg === "--bust" || arg === "--v") {
      const next = argv[++i];
      if (!next) throw new Error(`${arg} requires a value`);
      bust = next;
      continue;
    }
    if (arg.startsWith("--bust=")) {
      bust = arg.slice("--bust=".length);
      continue;
    }
    if (arg.startsWith("--v=")) {
      bust = arg.slice("--v=".length);
      continue;
    }
    if (!arg.startsWith("-") && !bust) {
      bust = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return bust || utcToday();
}

function loadBlobBaseFromEnvFile(): void {
  loadWebEnvFiles(webDir, {
    keys: BLOB_BASE_KEYS,
    onDiagnostic: warnEnvFileDiagnostic,
  });
}

function resolveBlobBase(): { base: URL; envKey: BlobBaseKey } {
  loadBlobBaseFromEnvFile();

  for (const key of BLOB_BASE_KEYS) {
    const raw = process.env[key]?.trim();
    if (!raw) continue;

    let base: URL;
    try {
      base = new URL(raw.endsWith("/") ? raw : `${raw}/`);
    } catch {
      throw new Error(`${key} is not a valid URL`);
    }

    if (base.protocol !== "https:" && base.protocol !== "http:") {
      throw new Error(`${key} must be an http(s) URL`);
    }
    return { base, envKey: key };
  }

  throw new Error("Missing BLOB_BASE_URL or NEXT_PUBLIC_BLOB_BASE_URL");
}

function viewUrl(base: URL, path: string, bust: string): URL {
  const url = new URL(path, base);
  url.searchParams.set("v", bust);
  return url;
}

async function readBlobJson(base: URL, path: string, bust: string): Promise<unknown> {
  const response = await fetch(viewUrl(base, path, bust), {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}`);
  return response.json();
}

function issueSummary(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string[] {
  return error.issues.slice(0, 5).map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}

function topRankItems(items: RankItem[], limit = 5): JsonObject[] {
  return items.slice(0, limit).map((item) => ({
    rank: item.rank,
    ...(item.id === undefined ? {} : { id: item.id }),
    ...(item.login === undefined ? {} : { login: item.login }),
    value: item.value,
  }));
}

function topCurrentStars(currentStars: Record<string, number>, limit = 5): JsonObject[] {
  return Object.entries(currentStars)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, value]) => {
      const numericId = Number(id);
      return {
        id: Number.isSafeInteger(numericId) ? numericId : id,
        value,
      };
    });
}

async function checkView<T>(
  base: URL,
  bust: string,
  path: string,
  schema: ZodType<T>,
  summarize: (data: T) => JsonObject | Promise<JsonObject>,
): Promise<ViewResult> {
  const url = viewUrl(base, path, bust);
  let response: Response;

  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch (error) {
    return {
      ok: false,
      path,
      notFound: false,
      error: error instanceof Error ? error.message : "Fetch failed",
    };
  }

  if (response.status === 404) {
    return { ok: false, path, status: 404, notFound: true, error: "Not found" };
  }
  if (!response.ok) {
    return {
      ok: false,
      path,
      status: response.status,
      notFound: false,
      error: `HTTP ${response.status}`,
    };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return {
      ok: false,
      path,
      status: response.status,
      notFound: false,
      error: "Response is not valid JSON",
    };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      path,
      status: response.status,
      notFound: false,
      error: "Contract validation failed",
      issues: issueSummary(parsed.error),
    };
  }

  return {
    ok: true,
    path,
    status: response.status,
    notFound: false,
    ...(await summarize(parsed.data)),
  };
}

async function resolveLiveRoot(base: URL, bust: string): Promise<{ root: string; generation: string | null; legacy: boolean }> {
  const response = await fetch(viewUrl(base, "live/latest.json", bust), {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (response.status === 404) return { root: "", generation: null, legacy: true };
  if (!response.ok) throw new Error(`live/latest.json -> HTTP ${response.status}`);
  const pointer = LiveGenerationPointer.parse(await response.json());
  if (!pointer.generation) return { root: "", generation: null, legacy: true };
  return {
    root: `live/generations/${pointer.generation}/`,
    generation: pointer.generation,
    legacy: false,
  };
}

async function main(): Promise<void> {
  const bust = parseArgs(process.argv.slice(2));
  const { base, envKey } = resolveBlobBase();
  const live = await resolveLiveRoot(base, bust);

  const views = await Promise.all([
    checkView(base, bust, `${live.root}current_month.json`, CurrentMonthDocument, async (data) => {
      const month = isCurrentMonthIndex(data)
        ? assembleCurrentMonth(
            data,
            await Promise.all(
              Array.from({ length: data.shard_count }, async (_, bucket) =>
                CurrentMonthShard.parse(
                  await readBlobJson(base, `${live.root}${currentMonthShardPath(bucket)}`, bust),
                ),
              ),
            ),
          )
        : data;
      return {
        schema: isCurrentMonthIndex(data) ? "v2-index" : "v1",
        month: month.month,
        updated: month.updated,
        daily_total_days: month.daily_totals.length,
        last_daily_total: month.daily_totals.at(-1) ?? null,
        repo_count: Object.keys(month.per_repo).length,
        current_stars_count: Object.keys(month.current_stars).length,
        current_stars_top: topCurrentStars(month.current_stars),
      };
    }),
    checkView(base, bust, `${live.root}hot-snapshot.json`, HotSnapshot, (data) => ({
      generated_at: data.generated_at,
      freshness: data.freshness ?? null,
      current_month_flow_top: topRankItems(data.current_month.flow),
      current_month_stock_top: topRankItems(data.current_month.stock),
      current_year_flow_top: topRankItems(data.current_year.flow),
      all_time_repo_top: topRankItems(data.all_time.repo),
      all_time_org_top: topRankItems(data.all_time.org),
      on_this_day_count: data.home.on_this_day.length,
    })),
  ]);

  const summary = {
    ok: views.every((view) => view.ok),
    bust,
    blob_base_env: envKey,
    generation: live.generation,
    legacy_layout: live.legacy,
    views,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.log(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected failure",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
