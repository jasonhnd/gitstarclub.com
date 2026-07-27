import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  DEFAULT_PUBLIC_BLOB_BASE,
  KNOWN_MISSING_LIVE_WEEKS,
  checkBasePublishFreshness,
  checkCurrentLivePeriods,
  checkLiveWeekContinuity,
  isoWeeksInYear,
  liveGatesRequired,
  previousIsoWeek,
  recentClosedWeeks,
  resolveLiveGateConfig,
  withinPublicationScheduleGrace,
} from "./release-gates-live";

const realFetch = globalThis.fetch;
let fetchCalls: string[] = [];

afterEach(() => {
  globalThis.fetch = realFetch;
  fetchCalls = [];
});

type JsonRoute = { status?: number; json?: unknown; body?: string };

function installJsonRoutes(routes: Record<string, JsonRoute>): void {
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchCalls.push(url);
    const route = routes[new URL(url).pathname] ?? { status: 404 };
    const status = route.status ?? 200;
    const body =
      route.body ??
      (route.json === undefined ? null : JSON.stringify(route.json));
    return new Response(body, {
      status,
      headers: body === null ? undefined : { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function livePointer(generation: string, previousGeneration: string | null) {
  return {
    schema_ver: 1,
    generation,
    run_id: generation,
    idempotency_key: "daily:2026-07-27",
    job: "daily",
    day: "2026-07-27",
    month: "2026-07",
    week: "2026-W31",
    published_at: "2026-07-27T03:05:00.000Z",
    previous_generation: previousGeneration,
    lease: null,
  };
}

function liveManifest(generation: string, previousGeneration: string | null, files: string[]) {
  return {
    schema_ver: 1,
    generation,
    run_id: generation,
    idempotency_key: "daily:2026-07-27",
    job: "daily",
    day: "2026-07-27",
    month: "2026-07",
    week: "2026-W31",
    created_at: "2026-07-27T03:05:00.000Z",
    previous_generation: previousGeneration,
    files,
  };
}

describe("release-gates-live config", () => {
  test("require flag is off by default", () => {
    expect(liveGatesRequired({})).toBe(false);
    expect(liveGatesRequired({ RELEASE_GATE_REQUIRE_LIVE: "1" })).toBe(true);
  });

  test("rejects missing site when resolving config", () => {
    const resolved = resolveLiveGateConfig({ BLOB_BASE_URL: DEFAULT_PUBLIC_BLOB_BASE });
    expect("error" in resolved).toBe(true);
  });

  test("rejects fixture blob hosts", () => {
    const resolved = resolveLiveGateConfig({
      RELEASE_GATE_SITE: "https://gitstarclub.com",
      BLOB_BASE_URL: "https://blob.example.com",
    });
    expect("error" in resolved).toBe(true);
  });

  test("accepts site + public default blob", () => {
    const resolved = resolveLiveGateConfig({ RELEASE_GATE_SITE: "https://gitstarclub.com" });
    expect("error" in resolved).toBe(false);
    if ("error" in resolved) return;
    expect(resolved.siteBase).toBe("https://gitstarclub.com");
    expect(resolved.blobBase).toBe(DEFAULT_PUBLIC_BLOB_BASE);
  });

  test("W27 is no longer a documented missing live week after GH Archive backfill", () => {
    expect(KNOWN_MISSING_LIVE_WEEKS).not.toContain("2026-W27");
    // Continuity scan still includes the week itself as a period to check.
    const scanned = recentClosedWeeks(new Date("2026-07-15T00:00:00.000Z"), 4);
    expect(scanned).toContain("2026-W27");
  });
});

describe("ISO week math", () => {
  test("2026 has 53 ISO weeks; 2027-W01 rolls back to 2026-W53", () => {
    expect(isoWeeksInYear(2026)).toBe(53);
    expect(previousIsoWeek("2027-W01")).toBe("2026-W53");
    expect(recentClosedWeeks(new Date("2027-01-04T12:00:00.000Z"), 2)).toEqual(["2026-W53", "2026-W52"]);
  });

  test("52-week year rolls back to W52", () => {
    // 2025 has 52 ISO weeks
    expect(isoWeeksInYear(2025)).toBe(52);
    expect(previousIsoWeek("2026-W01")).toBe("2025-W52");
  });
});

describe("publication schedule grace", () => {
  test("Monday early UTC defers current week requirement", () => {
    const mon0100 = new Date("2026-07-20T01:00:00.000Z"); // Monday
    expect(withinPublicationScheduleGrace(mon0100)).toEqual({ weekGrace: true, monthGrace: false });
  });

  test("first of month early UTC defers current month requirement", () => {
    const first = new Date("2026-08-01T01:30:00.000Z"); // Saturday 1st
    expect(withinPublicationScheduleGrace(first)).toEqual({ weekGrace: false, monthGrace: true });
  });

  test("mid-day Monday requires current week", () => {
    const mon1200 = new Date("2026-07-20T12:00:00.000Z");
    expect(withinPublicationScheduleGrace(mon1200)).toEqual({ weekGrace: false, monthGrace: false });
  });
});

describe("structured gate findings for non-JSON bodies", () => {
  test("200 HTML from Blob becomes a GateFinding, not an uncaught throw", async () => {
    globalThis.fetch = mock(async () =>
      new Response("<html>Forbidden</html>", { status: 200, headers: { "content-type": "text/html" } }),
    ) as unknown as typeof fetch;

    const finding = await checkBasePublishFreshness("https://blob.example-public.test");
    expect(finding.ok).toBe(false);
    expect(finding.id).toBe("base-pointer-json");
    expect(finding.summary).toContain("expected JSON");
  });
});

describe("generation-aware live period gates", () => {
  test("finds current shards in the head, a closed week in history, and older weeks in legacy flat", async () => {
    const currentWeek = "rank/week/2026-W31/repo/flow.json";
    const currentMonth = "rank/month/2026-07/repo/flow.json";
    const previousWeek = "rank/week/2026-W30/repo/flow.json";
    installJsonRoutes({
      "/live/latest.json": { json: livePointer("generation-w31", "generation-w30") },
      [`/live/generations/generation-w31/${currentWeek}`]: { json: { items: [] } },
      [`/live/generations/generation-w31/${currentMonth}`]: { json: { items: [] } },
      "/live/generations/generation-w31/manifest.json": {
        json: liveManifest("generation-w31", "generation-w30", [
          currentWeek,
          currentMonth,
          "current_month.json",
        ]),
      },
      "/live/generations/generation-w30/manifest.json": {
        json: liveManifest("generation-w30", null, [previousWeek]),
      },
      [`/live/generations/generation-w30/${previousWeek}`]: { json: { items: [] } },
      "/live/rank/week/2026-W29/repo/flow.json": { json: { items: [] } },
      "/live/rank/week/2026-W28/repo/flow.json": { json: { items: [] } },
      "/live/rank/week/2026-W27/repo/flow.json": { json: { items: [] } },
    });

    const now = new Date("2026-07-27T12:00:00.000Z");
    const current = await checkCurrentLivePeriods("https://blob.test", now);
    const continuity = await checkLiveWeekContinuity("https://blob.test", now);

    expect(current.ok).toBe(true);
    expect(current.observed?.sources).toContain("week:generation-w31");
    expect(continuity.ok).toBe(true);
    expect(continuity.observed?.sources).toContain("2026-W30:generation-w30");
    expect(continuity.observed?.sources).toContain("2026-W29:legacy-flat");
    expect(
      fetchCalls.some((url) => new URL(url).pathname === "/live/rank/week/2026-W30/repo/flow.json"),
    ).toBe(false);
  });

  test("reports a structured failure when a manifest-listed shard is missing", async () => {
    const previousWeek = "rank/week/2026-W30/repo/flow.json";
    installJsonRoutes({
      "/live/latest.json": { json: livePointer("generation-broken", null) },
      "/live/generations/generation-broken/manifest.json": {
        json: liveManifest("generation-broken", null, [previousWeek]),
      },
    });

    const finding = await checkLiveWeekContinuity(
      "https://blob.test",
      new Date("2026-07-27T12:00:00.000Z"),
    );
    expect(finding.ok).toBe(false);
    expect(finding.id).toBe("live-week-continuity");
    expect(finding.summary).toContain("manifest-listed artifact missing");
  });

  test("reports an invalid live pointer as a structured fail-closed finding", async () => {
    installJsonRoutes({
      "/live/latest.json": {
        json: { schema_ver: 1, generation: "generation-without-required-metadata" },
      },
    });

    const finding = await checkCurrentLivePeriods(
      "https://blob.test",
      new Date("2026-07-27T12:00:00.000Z"),
    );
    expect(finding.ok).toBe(false);
    expect(finding.id).toBe("live-current-periods");
    expect(finding.summary).toContain("live pointer invalid");
  });
});
