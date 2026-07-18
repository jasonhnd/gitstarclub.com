import { describe, expect, test } from "bun:test";
import { selectRankPayload } from "./rank";

// Recovered live-only weeks (e.g. 2026-W27 GH Archive WatchEvent backfill) must
// remain readable after folded_through advances past them when base has no view.
// Pure selection avoids mock.module on source/watermark — those mocks poison the
// shared Bun process and broke source.test.ts / watermark.test.ts on CI.

const liveW27 = {
  meta: {
    window: "week" as const,
    period: "2026-W27",
    dim: "repo" as const,
    metric: "flow" as const,
    generated_at: "2026-07-18T03:32:11.811Z",
  },
  items: [{ rank: 1, id: 1, value: 10, prev_rank: null }],
};

const baseW27 = {
  meta: { ...liveW27.meta, generated_at: "2026-07-20T00:00:00.000Z" },
  items: [{ rank: 1, id: 2, value: 99, prev_rank: null }],
};

describe("recovered week durability (selectRankPayload)", () => {
  test("serves live W27 while the period is still a live overlay", () => {
    expect(
      selectRankPayload({ live: liveW27, base: null, isLiveOverlay: true }),
    ).toEqual(liveW27);
  });

  test("still serves live W27 after fold advances when base is missing", () => {
    // fold watermark past W27 ⇒ isLiveOverlay=false; base absent ⇒ keep live.
    expect(
      selectRankPayload({ live: liveW27, base: null, isLiveOverlay: false }),
    ).toEqual(liveW27);
    expect(selectRankPayload({ live: liveW27, base: null, isLiveOverlay: false })?.meta.period).toBe(
      "2026-W27",
    );
  });

  test("prefers base once fold has materialised the period into base views", () => {
    expect(
      selectRankPayload({ live: liveW27, base: baseW27, isLiveOverlay: false }),
    ).toEqual(baseW27);
  });

  test("returns null when neither live nor base exists", () => {
    expect(selectRankPayload({ live: null, base: null, isLiveOverlay: false })).toBeNull();
  });
});
