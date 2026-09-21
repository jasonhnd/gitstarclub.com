import { LiveGenerationManifest } from "@/lib/contracts";

/**
 * Daily live publications form an immutable linked list. Sixty-four entries
 * cover more than two months of daily generations while keeping a corrupt or
 * unexpectedly long chain from turning one page read into an unbounded scan.
 *
 * A chain longer than this bound is expected when folding lags (pre is already
 * past 64 daily/weekly hops). That is a truncation signal, not page-fatal
 * corruption: cycle / schema / listed-but-missing still fail closed.
 */
export const MAX_LIVE_HISTORY_GENERATIONS = 64;

export type LiveArtifactResolution<T> = {
  value: T;
  source: "generation" | "legacy";
  generation: string | null;
  key: string;
};

export type LiveArtifactHistoryReader<T> = {
  /** Return null only for a confirmed 404. Transport/HTTP errors must throw. */
  readGenerationArtifact: (generation: string, logicalPath: string) => Promise<T | null>;
  /** Return null only for a confirmed 404. The resolver validates the schema. */
  readGenerationManifest: (generation: string) => Promise<unknown | null>;
  /** Optional pre-generation migration edge. Return null only for a confirmed 404. */
  readLegacyArtifact?: (legacyPath: string) => Promise<T | null>;
};

export type LiveLogicalPathPeriod = {
  window: "week" | "month";
  period: string;
};

/** Period-scoped liveHistory paths only. Snapshots do not walk history. */
export function liveLogicalPathPeriod(logicalPath: string): LiveLogicalPathPeriod | null {
  const week = /^rank\/week\/(\d{4}-W\d{2})\//.exec(logicalPath);
  if (week) return { window: "week", period: week[1] };
  const monthRank = /^rank\/month\/(\d{4}-\d{2})\//.exec(logicalPath);
  if (monthRank) return { window: "month", period: monthRank[1] };
  const monthHeat = /^heatmap\/month\/(\d{4}-\d{2})\.json$/.exec(logicalPath);
  if (monthHeat) return { window: "month", period: monthHeat[1] };
  return null;
}

function declaredPeriodForWindow(
  manifest: Pick<LiveGenerationManifest, "week" | "month">,
  window: LiveLogicalPathPeriod["window"],
): string {
  switch (window) {
    case "week":
      return manifest.week;
    case "month":
      return manifest.month;
    default: {
      const _exhaustive: never = window;
      throw new Error(`unexpected live period window: ${_exhaustive}`);
    }
  }
}

/**
 * Older hops cannot contain a newer week/month. Lexicographic compare is safe
 * for zero-padded `YYYY-MM` and `YYYY-Www` ids.
 */
export function manifestPeriodIsOlderThanRequest(
  manifest: Pick<LiveGenerationManifest, "week" | "month">,
  requested: LiveLogicalPathPeriod,
): boolean {
  return requested.period > declaredPeriodForWindow(manifest, requested.window);
}

function assertSafeRelativeJsonPath(path: string): void {
  if (!path || path.startsWith("/") || path.split("/").includes("..") || !path.endsWith(".json")) {
    throw new Error(`unsafe live artifact path: ${path}`);
  }
}

async function readLegacy<T>(
  legacyPath: string | undefined,
  reader: LiveArtifactHistoryReader<T>,
): Promise<LiveArtifactResolution<T> | null> {
  if (!legacyPath || !reader.readLegacyArtifact) return null;
  const value = await reader.readLegacyArtifact(legacyPath);
  return value === null ? null : { value, source: "legacy", generation: null, key: legacyPath };
}

/**
 * Resolve an immutable period-scoped live artifact.
 *
 * The current generation gets a direct fast-path read. On a confirmed 404,
 * manifests are followed backwards until one declares the requested artifact.
 * A declared-but-missing object, invalid/missing manifest, or cycle fails
 * closed. A requested period newer than the hop's declared week/month cannot
 * exist further back, so the walk stops and may use the legacy migration edge.
 * Hitting the hop bound without a null edge truncates: return null rather than
 * 500, and do not guess legacy bytes that were not reached through `null`.
 */
export async function resolveLiveArtifactFromHistory<T>(args: {
  headGeneration: string | null;
  logicalPath: string;
  legacyPath?: string;
  reader: LiveArtifactHistoryReader<T>;
  maxGenerations?: number;
}): Promise<LiveArtifactResolution<T> | null> {
  const {
    headGeneration,
    logicalPath,
    legacyPath,
    reader,
    maxGenerations = MAX_LIVE_HISTORY_GENERATIONS,
  } = args;
  assertSafeRelativeJsonPath(logicalPath);
  if (legacyPath) assertSafeRelativeJsonPath(legacyPath);
  if (!Number.isSafeInteger(maxGenerations) || maxGenerations < 1) {
    throw new Error(`invalid live history bound: ${maxGenerations}`);
  }
  if (headGeneration === null) return readLegacy(legacyPath, reader);

  const requestedPeriod = liveLogicalPathPeriod(logicalPath);
  const seen = new Set<string>();
  let generation: string | null = headGeneration;
  for (let depth = 0; generation !== null && depth < maxGenerations; depth++) {
    if (seen.has(generation)) {
      throw new Error(`live generation history cycle at ${generation}`);
    }
    seen.add(generation);

    // Most reads are for the current week/month. Avoid a manifest request on
    // that hot path, while still validating the manifest if the object is absent.
    if (depth === 0) {
      const value = await reader.readGenerationArtifact(generation, logicalPath);
      if (value !== null) {
        return {
          value,
          source: "generation",
          generation,
          key: `live/generations/${generation}/${logicalPath}`,
        };
      }
    }

    const rawManifest = await reader.readGenerationManifest(generation);
    if (rawManifest === null) {
      throw new Error(`live generation ${generation} manifest missing`);
    }
    const parsedManifest = LiveGenerationManifest.safeParse(rawManifest);
    if (!parsedManifest.success) {
      const issue = parsedManifest.error.issues[0];
      const location = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
      throw new Error(
        `live generation ${generation} manifest invalid${location}: ${issue?.message ?? "schema mismatch"}`,
      );
    }
    const manifest = parsedManifest.data;
    if (manifest.generation !== generation) {
      throw new Error(
        `live generation manifest mismatch: requested ${generation}, received ${manifest.generation}`,
      );
    }

    if (manifest.files.includes(logicalPath)) {
      // depth=0 already performed the direct read, so reaching this branch
      // means the manifest promises an object that returned a confirmed 404.
      if (depth === 0) {
        throw new Error(`live generation ${generation} manifest-listed artifact missing: ${logicalPath}`);
      }
      const value = await reader.readGenerationArtifact(generation, logicalPath);
      if (value === null) {
        throw new Error(`live generation ${generation} manifest-listed artifact missing: ${logicalPath}`);
      }
      return {
        value,
        source: "generation",
        generation,
        key: `live/generations/${generation}/${logicalPath}`,
      };
    }

    // Head (or this hop) is an older week/month than the request. Remaining
    // previous_generation links are older still, so stop instead of scanning
    // a 64+ daily chain for a period that has not been published yet.
    if (requestedPeriod && manifestPeriodIsOlderThanRequest(manifest, requestedPeriod)) {
      generation = null;
      break;
    }
    generation = manifest.previous_generation;
  }

  if (generation !== null) {
    // Bound hit with more hops remaining. Treat as a truncated scan, not a
    // 500: pages fall back to base / empty. Do not use the legacy edge —
    // that is only valid after a complete walk to previous_generation:null.
    return null;
  }
  return readLegacy(legacyPath, reader);
}
