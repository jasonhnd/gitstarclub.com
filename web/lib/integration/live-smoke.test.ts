import { test, expect, describe, spyOn } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBlobBaseFromEnvFile, resolveLiveSmokeConfig } from "./live-smoke-config";

// ─────────────────────────────────────────────────────────────────────────────
// LIVE network/integration smoke test.
//
// This suite hits a LIVE deploy + the public Vercel Blob store and asserts core
// health: pages serve 200 with the expected chrome/content, the static HTML is
// default-locale English, and the published view pointer resolves to a
// versioned all-time stock ranking with the right shape.
//
// It is OPT-IN. The network suite is registered only when RUN_LIVE_SMOKE=1 and
// LIVE_SMOKE_SITE_URL names the target origin; there is no default site. Without
// that opt-in, web/.env.local is not even read and `bun run test` makes no
// request from this file. Run it on demand, e.g.
//   RUN_LIVE_SMOKE=1 LIVE_SMOKE_SITE_URL=https://pre.gitstarclub.com \
//     bun test lib/integration/live-smoke.test.ts
// If the site is unreachable every assertion fails with a clear "unreachable" message.
//
// SECURITY: only BLOB_BASE_URL is read from web/.env.local (matched by regex on a
// single line). The BLOB_READ_WRITE_TOKEN and every other secret are never read,
// logged, or echoed — the Blob store is public, so a base URL is all we need.
// ─────────────────────────────────────────────────────────────────────────────

/** Per-request budget — generous, because cold ISR paths + Blob can be slow. */
const REQUEST_TIMEOUT_MS = 30_000;

// lib/integration/ → ../../.env.local
const ENV_LOCAL_PATH = join(import.meta.dir, "..", "..", ".env.local");

const LIVE = resolveLiveSmokeConfig(process.env, () => readBlobBaseFromEnvFile(ENV_LOCAL_PATH));

interface FetchResult {
  status: number;
  text: string;
}

/** GET a URL with a timeout; turn transport failures into a clear, actionable error. */
async function fetchUrl(url: string): Promise<FetchResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "user-agent": "gitstarclub-live-smoke" },
      redirect: "follow",
    });
  } catch (err) {
    // Offline / DNS / TLS / timeout — these tests require the live deploy.
    throw new Error(
      `UNREACHABLE: ${url} — ${(err as Error).message}. ` +
        `This is a network/integration test; it needs internet and the live deploy.`,
    );
  }
  const text = await res.text();
  return { status: res.status, text };
}

/** GET expecting 200 + HTML/text; returns the body. Fails loudly otherwise. */
async function getOk(url: string): Promise<string> {
  const { status, text } = await fetchUrl(url);
  if (status !== 200) {
    throw new Error(`expected 200 from ${url}, got ${status}`);
  }
  return text;
}

/** GET expecting 200 + JSON; parses and returns it. Fails loudly otherwise. */
async function getJson(url: string): Promise<unknown> {
  const body = await getOk(url);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`expected JSON from ${url}, got non-JSON body`);
  }
}

/** Current UTC year + numeric month — month period URLs use the bare number (e.g. /2026/6). */
function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

// ── Opt-in gate: offline checks that always run ─────────────────────────────
describe("live-smoke gate [offline]", () => {
  const blobFromFile = "https://blob.example.com";
  const site = "https://smoke.example.com";

  test("without RUN_LIVE_SMOKE the suite is disabled and web/.env.local is not read", () => {
    let reads = 0;
    const config = resolveLiveSmokeConfig({ LIVE_SMOKE_SITE_URL: site }, () => {
      reads++;
      return blobFromFile;
    });
    expect(config).toEqual({ enabled: false, reason: "RUN_LIVE_SMOKE is not 1" });
    expect(reads).toBe(0);
  });

  test("RUN_LIVE_SMOKE must be exactly \"1\"", () => {
    for (const value of ["", "0", "true", "yes", " 1"]) {
      const config = resolveLiveSmokeConfig(
        { RUN_LIVE_SMOKE: value, LIVE_SMOKE_SITE_URL: site, BLOB_BASE_URL: blobFromFile },
        () => blobFromFile,
      );
      expect(config.enabled).toBe(false);
    }
  });

  test("RUN_LIVE_SMOKE=1 without LIVE_SMOKE_SITE_URL has no default site", () => {
    let reads = 0;
    const config = resolveLiveSmokeConfig({ RUN_LIVE_SMOKE: "1", BLOB_BASE_URL: blobFromFile }, () => {
      reads++;
      return blobFromFile;
    });
    expect(config).toEqual({ enabled: false, reason: "LIVE_SMOKE_SITE_URL is not set" });
    expect(reads).toBe(0);
  });

  test("a non-http(s) LIVE_SMOKE_SITE_URL is rejected", () => {
    for (const value of ["pre.gitstarclub.com", "ftp://example.com", "javascript:alert(1)"]) {
      const config = resolveLiveSmokeConfig(
        { RUN_LIVE_SMOKE: "1", LIVE_SMOKE_SITE_URL: value, BLOB_BASE_URL: blobFromFile },
        () => null,
      );
      expect(config.enabled).toBe(false);
    }
  });

  test("RUN_LIVE_SMOKE=1 + site: web/.env.local Blob base wins over env, trailing slashes trimmed", () => {
    const config = resolveLiveSmokeConfig(
      { RUN_LIVE_SMOKE: "1", LIVE_SMOKE_SITE_URL: `${site}//`, BLOB_BASE_URL: "https://env.example.com" },
      () => blobFromFile,
    );
    expect(config).toEqual({ enabled: true, site, blobBase: blobFromFile });
  });

  test("RUN_LIVE_SMOKE=1 + site: falls back to BLOB_BASE_URL, then NEXT_PUBLIC_BLOB_BASE_URL", () => {
    expect(
      resolveLiveSmokeConfig(
        { RUN_LIVE_SMOKE: "1", LIVE_SMOKE_SITE_URL: site, BLOB_BASE_URL: "https://env.example.com/" },
        () => null,
      ),
    ).toEqual({ enabled: true, site, blobBase: "https://env.example.com" });
    expect(
      resolveLiveSmokeConfig(
        { RUN_LIVE_SMOKE: "1", LIVE_SMOKE_SITE_URL: site, NEXT_PUBLIC_BLOB_BASE_URL: "https://pub.example.com" },
        () => null,
      ),
    ).toEqual({ enabled: true, site, blobBase: "https://pub.example.com" });
  });

  test("RUN_LIVE_SMOKE=1 + site but no Blob base anywhere stays disabled", () => {
    const config = resolveLiveSmokeConfig({ RUN_LIVE_SMOKE: "1", LIVE_SMOKE_SITE_URL: site }, () => null);
    expect(config.enabled).toBe(false);
  });

  test("readBlobBaseFromEnvFile reads only the BLOB_BASE_URL line", () => {
    const dir = mkdtempSync(join(tmpdir(), "live-smoke-env-"));
    try {
      const envPath = join(dir, ".env.local");
      expect(readBlobBaseFromEnvFile(envPath)).toBeNull();
      writeFileSync(envPath, 'BLOB_READ_WRITE_TOKEN="placeholder"\nOTHER=1\n');
      expect(readBlobBaseFromEnvFile(envPath)).toBeNull();
      writeFileSync(envPath, 'BLOB_READ_WRITE_TOKEN="placeholder"\nBLOB_BASE_URL="https://blob.example.com/"\n');
      expect(readBlobBaseFromEnvFile(envPath)).toBe("https://blob.example.com");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the gate itself performs no network request", () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    try {
      resolveLiveSmokeConfig({}, () => blobFromFile);
      resolveLiveSmokeConfig({ RUN_LIVE_SMOKE: "1", LIVE_SMOKE_SITE_URL: site }, () => blobFromFile);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("this process only registers the network suite under the explicit opt-in", () => {
    if (process.env.RUN_LIVE_SMOKE !== "1" || !process.env.LIVE_SMOKE_SITE_URL) {
      expect(LIVE.enabled).toBe(false);
    }
  });
});

if (!LIVE.enabled) {
  console.warn(`[live-smoke.test] SKIP network suite: ${LIVE.reason}.`);
  test.skip(`live smoke [network] skipped: ${LIVE.reason}`, () => {});
} else {
  const SITE = LIVE.site;
  const BLOB_BASE = LIVE.blobBase;

  // describe block name flags this as live/network for filtered runs and CI reporting.
  describe("live-smoke [network] — live deploy + Blob health", () => {
  // ── Pages: 200 + expected content ─────────────────────────────────────────
  // Every surface renders the shared <Chrome>, whose default-locale nav contains
  // "Rankings" and "Pulse". We assert on that stable chrome (plus a per-page
  // signal) rather than brittle body copy.

  describe("pages return 200 with expected chrome/content", () => {
    test("home / — title + Rankings/Pulse chrome", async () => {
      const html = await getOk(`${SITE}/`);
      expect(html).toContain("GitStarClub");
      expect(html).toContain("Rankings");
      expect(html).toContain("Pulse");
    });

    test("/rankings — all-time rankings page", async () => {
      const html = await getOk(`${SITE}/rankings`);
      expect(html).toContain("Rankings");
      expect(html).toContain("Pulse");
    });

    test("/rankings/<year>/<month> — current month (numeric month URL)", async () => {
      const { year, month } = currentYearMonth();
      const html = await getOk(`${SITE}/rankings/${year}/${month}`);
      expect(html).toContain(String(year));
      expect(html).toContain("Rankings");
    });

    test("/rankings/2024/6 — past month (served from base)", async () => {
      const html = await getOk(`${SITE}/rankings/2024/6`);
      expect(html).toContain("2024");
      expect(html).toContain("Rankings");
    });

    test("/rankings/2026/W23 — week page (current-era week)", async () => {
      const html = await getOk(`${SITE}/rankings/2026/W23`);
      expect(html).toContain("2026-W23");
      expect(html).toContain("Rankings");
    });

    test("/rankings/2024/W10 — past week page", async () => {
      const html = await getOk(`${SITE}/rankings/2024/W10`);
      expect(html).toContain("2024-W10");
      expect(html).toContain("Rankings");
    });

    test("/vuejs/vue — repo entity page", async () => {
      const html = await getOk(`${SITE}/vuejs/vue`);
      expect(html).toContain("vuejs/vue");
      expect(html).toContain("Rankings");
    });

    test("/o/microsoft — org page", async () => {
      const html = await getOk(`${SITE}/o/microsoft`);
      expect(html).toContain("microsoft");
      expect(html).toContain("Rankings");
    });

    test("/about — about page", async () => {
      const html = await getOk(`${SITE}/about`);
      expect(html).toContain("GitStarClub");
      expect(html).toContain("Pulse");
    });

    test("/pulse — pulse page", async () => {
      const html = await getOk(`${SITE}/pulse`);
      expect(html).toContain("Rankings");
      expect(html).toContain("Pulse");
    });
  });

  // ── Static HTML is default-locale English ─────────────────────────────────
  test("home HTML is default-locale English (<html ... lang=\"en\">)", async () => {
    const html = await getOk(`${SITE}/`);
    // Allow arbitrary attributes between `<html` and `lang="en"` (e.g. data-dpl-id).
    expect(html).toMatch(/<html[^>]*\blang="en"/);
  });

  // ── Publish pointer + versioned all-time stock ────────────────────────────
  describe("Blob publish pointer + versioned all-time stock", () => {
    test("views/latest.json resolves to a versioned stock.json with rank===1 + descending values", async () => {
      // 1) Publish pointer shape: { version, run_id, published_at, prev_version, schema_ver }.
      const pointer = (await getJson(`${BLOB_BASE}/views/latest.json`)) as Record<string, unknown>;
      expect(typeof pointer.version).toBe("string");
      expect(typeof pointer.run_id).toBe("string");
      expect(typeof pointer.published_at).toBe("string");
      // prev_version is nullable (null on first-ever publish).
      expect(pointer.prev_version === null || typeof pointer.prev_version === "string").toBe(true);
      expect(typeof pointer.schema_ver).toBe("number");

      const version = pointer.version as string;
      expect(version.length).toBeGreaterThan(0);

      // 2) The referenced version's all-time repo stock list.
      const stock = (await getJson(
        `${BLOB_BASE}/views/${encodeURIComponent(version)}/rank/all-time/repo/stock.json`,
      )) as { items?: Array<{ rank: number; value: number }> };

      const items = stock.items;
      expect(Array.isArray(items)).toBe(true);
      expect(items!.length).toBeGreaterThan(0);
      expect(items![0].rank).toBe(1);

      // Values must be non-increasing (stock ranking is descending by total stars).
      let descending = true;
      for (let i = 1; i < items!.length; i++) {
        if (items![i].value > items![i - 1].value) {
          descending = false;
          break;
        }
      }
      expect(descending).toBe(true);
    });
  });

  // ── SEO endpoints ─────────────────────────────────────────────────────────
  describe("SEO endpoints return 200", () => {
    test("/sitemap.xml", async () => {
      // Root sitemap is a per-locale index (sitemap-en.xml, sitemap-ja.xml, …), not a urlset.
      const xml = await getOk(`${SITE}/sitemap.xml`);
      expect(xml).toContain("<sitemapindex");
      expect(xml).toMatch(/<loc>[^<]*sitemap-[^<]+\.xml<\/loc>/);
    });

    test("/robots.txt", async () => {
      const txt = await getOk(`${SITE}/robots.txt`);
      expect(txt).toContain("User-Agent");
    });
  });
  });
}
