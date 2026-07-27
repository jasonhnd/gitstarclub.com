import { LiveGenerationManifest } from "@/lib/contracts";

/**
 * Daily live publications form an immutable linked list. Sixty-four entries
 * cover more than two months of daily generations while keeping corrupt or
 * unexpectedly long chains from turning one page read into an unbounded scan.
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
 * A declared-but-missing object, invalid/missing manifest, cycle, or excessive
 * chain fails closed. The legacy flat path is considered only after a valid
 * chain reaches its explicit null migration edge.
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
    generation = manifest.previous_generation;
  }

  if (generation !== null) {
    throw new Error(`live generation history exceeds ${maxGenerations} entries`);
  }
  return readLegacy(legacyPath, reader);
}
