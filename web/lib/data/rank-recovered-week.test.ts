import { afterEach, describe, expect, mock, test } from "bun:test";

// When fold watermark advances past a recovered live-only week (e.g. 2026-W27),
// getRank must still resolve that week from the live shard if base is absent.

const livePayload = {
  meta: {
    window: "week" as const,
    period: "2026-W27",
    dim: "repo" as const,
    metric: "flow" as const,
    generated_at: "2026-07-18T03:32:11.811Z",
  },
  items: [{ rank: 1, id: 1, value: 10, prev_rank: null }],
};

let foldWeek = "2026-W26";
const readView = mock(async (path: string, _schema: unknown, opts?: { live?: boolean; legacyPath?: string }) => {
  if (opts?.live || opts?.legacyPath?.startsWith("live/")) {
    if (path.includes("2026-W27") || opts?.legacyPath?.includes("2026-W27")) return livePayload;
    return null;
  }
  // base rank path
  return null;
});

mock.module("./source", () => ({
  readView,
  DAILY_BASE_VIEW_OPTS: { base: true, versionTtlMs: 86_400_000 },
  DAILY_BASE_VIEW_TTL_MS: 86_400_000,
}));

mock.module("./watermark", () => ({
  isLiveOverlayPeriod: async (_w: string, period: string) => period > foldWeek,
}));

afterEach(() => {
  readView.mockClear();
  foldWeek = "2026-W26";
});

describe("recovered week durability", () => {
  test("serves live W27 while fold watermark is still W26", async () => {
    foldWeek = "2026-W26";
    const { getRank } = await import(`./rank?w26=${Date.now()}`);
    const rank = await getRank("week", "2026-W27", "repo", "flow");
    expect(rank?.meta.period).toBe("2026-W27");
    expect(rank?.items[0]?.value).toBe(10);
  });

  test("still serves live W27 after fold watermark advances past W27 when base is missing", async () => {
    foldWeek = "2026-W28";
    const { getRank } = await import(`./rank?w28=${Date.now()}`);
    const rank = await getRank("week", "2026-W27", "repo", "flow");
    expect(rank?.meta.period).toBe("2026-W27");
    expect(rank?.items[0]?.id).toBe(1);
  });
});
