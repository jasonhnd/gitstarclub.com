import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// LIVE network/integration smoke test.
//
// This suite hits the LIVE production deploy + the public Vercel Blob store and
// asserts core health: pages serve 200 with the expected chrome/content, the
// static HTML is default-locale English, and the published view pointer resolves
// to a versioned all-time stock ranking with the right shape.
//
// It is NOT a unit test: it needs internet and an up-to-date deploy. Run it in CI
// or on demand (`bun test lib/integration/live-smoke.test.ts`), never offline. If
// the site is unreachable every assertion fails with a clear "unreachable" message.
//
// SECURITY: only BLOB_BASE_URL is read from web/.env.local (matched by regex on a
// single line). The BLOB_READ_WRITE_TOKEN and every other secret are never read,
// logged, or echoed — the Blob store is public, so a base URL is all we need.
// ─────────────────────────────────────────────────────────────────────────────

const SITE = "https://www.gitstarclub.com";

/** Per-request budget — generous, because cold ISR paths + Blob can be slow. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Read ONLY the BLOB_BASE_URL line from web/.env.local. Never touches the token. */
function readBlobBase(): string | null {
  // lib/integration/ → ../../.env.local
  const envPath = join(import.meta.dir, "..", "..", ".env.local");
  let raw: string;
  try {
    raw = readFileSync(envPath, "utf8");
  } catch {
    return null;
  }
  // Match exactly the BLOB_BASE_URL assignment; ignore BLOB_READ_WRITE_TOKEN etc.
  const match = raw.match(/^\s*BLOB_BASE_URL\s*=\s*"?([^"\r\n]+)"?\s*$/m);
  if (!match) return null;
  return match[1].trim().replace(/\/+$/, "");
}

const BLOB_BASE = (
  readBlobBase() ??
  (process.env.RUN_LIVE_SMOKE === "1" ? (process.env.BLOB_BASE_URL ?? process.env.NEXT_PUBLIC_BLOB_BASE_URL) : "") ??
  ""
).replace(/\/+$/, "");

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

// describe block name flags this as live/network for filtered runs and CI reporting.
if (!BLOB_BASE) {
  console.warn("[live-smoke.test] SKIP: BLOB_BASE_URL not found; live network smoke not run.");
  test.skip("live smoke requires BLOB_BASE_URL", () => {});
} else {
  describe("live-smoke [network] — production deploy + Blob health", () => {
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
      const xml = await getOk(`${SITE}/sitemap.xml`);
      expect(xml).toContain("<urlset");
    });

    test("/robots.txt", async () => {
      const txt = await getOk(`${SITE}/robots.txt`);
      expect(txt).toContain("User-Agent");
    });
  });
  });
}
