import { describe, expect, test } from "bun:test";
import {
  MAX_LIVE_HISTORY_GENERATIONS,
  liveLogicalPathPeriod,
  manifestPeriodIsOlderThanRequest,
  resolveLiveArtifactFromHistory,
  type LiveArtifactHistoryReader,
} from "./live-generation-history";

type Artifact = { tag: string };

function manifest(
  generation: string,
  previousGeneration: string | null,
  files: string[],
  periods?: { week?: string; month?: string; day?: string },
) {
  return {
    schema_ver: 1,
    generation,
    run_id: generation,
    idempotency_key: `daily:${generation}`,
    job: "daily",
    day: periods?.day ?? "2026-07-27",
    month: periods?.month ?? "2026-07",
    week: periods?.week ?? "2026-W31",
    created_at: "2026-07-27T03:05:00.000Z",
    previous_generation: previousGeneration,
    files,
  };
}

function fakeReader(args: {
  artifacts?: Record<string, Artifact>;
  manifests?: Record<string, unknown>;
  legacy?: Record<string, Artifact>;
  calls?: string[];
}): LiveArtifactHistoryReader<Artifact> {
  return {
    readGenerationArtifact: async (generation, logicalPath) => {
      args.calls?.push(`artifact:${generation}:${logicalPath}`);
      return args.artifacts?.[`${generation}/${logicalPath}`] ?? null;
    },
    readGenerationManifest: async (generation) => {
      args.calls?.push(`manifest:${generation}`);
      return args.manifests?.[generation] ?? null;
    },
    readLegacyArtifact: async (legacyPath) => {
      args.calls?.push(`legacy:${legacyPath}`);
      return args.legacy?.[legacyPath] ?? null;
    },
  };
}

const PATH = "rank/week/2026-W30/repo/flow.json";
const LEGACY_PATH = `live/${PATH}`;

describe("resolveLiveArtifactFromHistory", () => {
  test("uses the current generation fast path without fetching its manifest", async () => {
    const calls: string[] = [];
    const result = await resolveLiveArtifactFromHistory({
      headGeneration: "generation-current",
      logicalPath: PATH,
      legacyPath: LEGACY_PATH,
      reader: fakeReader({
        artifacts: { [`generation-current/${PATH}`]: { tag: "current" } },
        calls,
      }),
    });

    expect(result).toEqual({
      value: { tag: "current" },
      source: "generation",
      generation: "generation-current",
      key: `live/generations/generation-current/${PATH}`,
    });
    expect(calls).toEqual([`artifact:generation-current:${PATH}`]);
  });

  test("walks validated manifests and reads the generation that declares the artifact", async () => {
    const calls: string[] = [];
    const result = await resolveLiveArtifactFromHistory({
      headGeneration: "generation-new",
      logicalPath: PATH,
      legacyPath: LEGACY_PATH,
      reader: fakeReader({
        artifacts: { [`generation-old/${PATH}`]: { tag: "previous" } },
        manifests: {
          "generation-new": manifest("generation-new", "generation-middle", ["current_month.json"]),
          "generation-middle": manifest("generation-middle", "generation-old", ["hot-snapshot.json"]),
          "generation-old": manifest("generation-old", null, [PATH]),
        },
        calls,
      }),
    });

    expect(result?.value.tag).toBe("previous");
    expect(result?.generation).toBe("generation-old");
    expect(calls).toEqual([
      `artifact:generation-new:${PATH}`,
      "manifest:generation-new",
      "manifest:generation-middle",
      "manifest:generation-old",
      `artifact:generation-old:${PATH}`,
    ]);
  });

  test("uses the legacy migration edge only after a valid chain is exhausted", async () => {
    const calls: string[] = [];
    const result = await resolveLiveArtifactFromHistory({
      headGeneration: "generation-first",
      logicalPath: PATH,
      legacyPath: LEGACY_PATH,
      reader: fakeReader({
        manifests: {
          "generation-first": manifest("generation-first", null, ["current_month.json"]),
        },
        legacy: { [LEGACY_PATH]: { tag: "legacy" } },
        calls,
      }),
    });

    expect(result).toEqual({
      value: { tag: "legacy" },
      source: "legacy",
      generation: null,
      key: LEGACY_PATH,
    });
    expect(calls.at(-1)).toBe(`legacy:${LEGACY_PATH}`);
  });

  test("fails closed when a manifest-listed artifact is missing", async () => {
    await expect(
      resolveLiveArtifactFromHistory({
        headGeneration: "generation-broken",
        logicalPath: PATH,
        legacyPath: LEGACY_PATH,
        reader: fakeReader({
          manifests: {
            "generation-broken": manifest("generation-broken", null, [PATH]),
          },
          legacy: { [LEGACY_PATH]: { tag: "must-not-be-used" } },
        }),
      }),
    ).rejects.toThrow(`manifest-listed artifact missing: ${PATH}`);
  });

  test("fails closed on a missing manifest or cycle", async () => {
    await expect(
      resolveLiveArtifactFromHistory({
        headGeneration: "generation-missing-manifest",
        logicalPath: PATH,
        legacyPath: LEGACY_PATH,
        reader: fakeReader({ legacy: { [LEGACY_PATH]: { tag: "must-not-be-used" } } }),
      }),
    ).rejects.toThrow("generation-missing-manifest manifest missing");

    await expect(
      resolveLiveArtifactFromHistory({
        headGeneration: "generation-a",
        logicalPath: PATH,
        reader: fakeReader({
          manifests: {
            "generation-a": manifest("generation-a", "generation-b", ["current_month.json"]),
            "generation-b": manifest("generation-b", "generation-a", ["current_month.json"]),
          },
        }),
      }),
    ).rejects.toThrow("history cycle at generation-a");
  });

  test("truncates an excessive chain without throwing or guessing legacy bytes", async () => {
    const calls: string[] = [];
    const sameWeekPath = "rank/week/2026-W31/repo/flow.json";
    await expect(
      resolveLiveArtifactFromHistory({
        headGeneration: "generation-a",
        logicalPath: sameWeekPath,
        legacyPath: `live/${sameWeekPath}`,
        maxGenerations: 1,
        reader: fakeReader({
          manifests: {
            "generation-a": manifest("generation-a", "generation-b", ["current_month.json"]),
          },
          legacy: { [`live/${sameWeekPath}`]: { tag: "must-not-be-used" } },
          calls,
        }),
      }),
    ).resolves.toBeNull();
    expect(calls).toEqual([`artifact:generation-a:${sameWeekPath}`, "manifest:generation-a"]);
    expect(MAX_LIVE_HISTORY_GENERATIONS).toBe(64);
  });

  test("stops when the requested period is newer than the hop and may use legacy", async () => {
    const futureWeek = "rank/week/2026-W39/repo/flow.json";
    const calls: string[] = [];
    const result = await resolveLiveArtifactFromHistory({
      headGeneration: "generation-w38",
      logicalPath: futureWeek,
      legacyPath: `live/${futureWeek}`,
      reader: fakeReader({
        manifests: {
          "generation-w38": manifest(
            "generation-w38",
            "generation-w37",
            ["rank/week/2026-W38/repo/flow.json"],
            { week: "2026-W38", month: "2026-09", day: "2026-09-20" },
          ),
          "generation-w37": manifest(
            "generation-w37",
            "generation-w36",
            ["rank/week/2026-W37/repo/flow.json"],
            { week: "2026-W37", month: "2026-09", day: "2026-09-13" },
          ),
        },
        legacy: { [`live/${futureWeek}`]: { tag: "legacy-future" } },
        calls,
      }),
    });

    expect(result).toEqual({
      value: { tag: "legacy-future" },
      source: "legacy",
      generation: null,
      key: `live/${futureWeek}`,
    });
    expect(calls).toEqual([
      `artifact:generation-w38:${futureWeek}`,
      "manifest:generation-w38",
      `legacy:live/${futureWeek}`,
    ]);
  });

  test("stops a future-period miss without legacy when the migration edge is absent", async () => {
    const futureWeek = "rank/week/2026-W39/repo/flow.json";
    await expect(
      resolveLiveArtifactFromHistory({
        headGeneration: "generation-w38",
        logicalPath: futureWeek,
        reader: fakeReader({
          manifests: {
            "generation-w38": manifest(
              "generation-w38",
              "generation-w37",
              ["rank/week/2026-W38/repo/flow.json"],
              { week: "2026-W38", month: "2026-09", day: "2026-09-20" },
            ),
          },
        }),
      }),
    ).resolves.toBeNull();
  });

  test("classifies period-scoped live paths and compares manifest recency", () => {
    expect(liveLogicalPathPeriod("rank/week/2026-W39/repo/flow.json")).toEqual({
      window: "week",
      period: "2026-W39",
    });
    expect(liveLogicalPathPeriod("rank/month/2026-09/repo/stock.json")).toEqual({
      window: "month",
      period: "2026-09",
    });
    expect(liveLogicalPathPeriod("heatmap/month/2026-09.json")).toEqual({
      window: "month",
      period: "2026-09",
    });
    expect(liveLogicalPathPeriod("hot-snapshot.json")).toBeNull();
    expect(
      manifestPeriodIsOlderThanRequest(
        { week: "2026-W38", month: "2026-09" },
        { window: "week", period: "2026-W39" },
      ),
    ).toBe(true);
    expect(
      manifestPeriodIsOlderThanRequest(
        { week: "2026-W38", month: "2026-09" },
        { window: "week", period: "2026-W38" },
      ),
    ).toBe(false);
    expect(
      manifestPeriodIsOlderThanRequest(
        { week: "2026-W38", month: "2026-08" },
        { window: "month", period: "2026-09" },
      ),
    ).toBe(true);
  });

  test("fails closed on manifest identity mismatch and unsafe paths", async () => {
    await expect(
      resolveLiveArtifactFromHistory({
        headGeneration: "generation-requested",
        logicalPath: PATH,
        reader: fakeReader({
          manifests: {
            "generation-requested": manifest("generation-other", null, ["current_month.json"]),
          },
        }),
      }),
    ).rejects.toThrow("manifest mismatch");

    await expect(
      resolveLiveArtifactFromHistory({
        headGeneration: "generation-invalid",
        logicalPath: PATH,
        reader: fakeReader({
          manifests: {
            "generation-invalid": { generation: "generation-invalid", files: [PATH] },
          },
        }),
      }),
    ).rejects.toThrow("generation-invalid manifest invalid");

    await expect(
      resolveLiveArtifactFromHistory({
        headGeneration: null,
        logicalPath: "../escape.json",
        reader: fakeReader({}),
      }),
    ).rejects.toThrow("unsafe live artifact path");
  });

  test("propagates transport failures without trying legacy bytes", async () => {
    const calls: string[] = [];
    await expect(
      resolveLiveArtifactFromHistory({
        headGeneration: "generation-unreachable",
        logicalPath: PATH,
        legacyPath: LEGACY_PATH,
        reader: {
          readGenerationArtifact: async () => {
            calls.push("artifact");
            throw new Error("network down");
          },
          readGenerationManifest: async () => {
            calls.push("manifest");
            return null;
          },
          readLegacyArtifact: async () => {
            calls.push("legacy");
            return { tag: "must-not-be-used" };
          },
        },
      }),
    ).rejects.toThrow("network down");
    expect(calls).toEqual(["artifact"]);
  });
});
