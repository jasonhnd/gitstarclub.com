import { afterAll, beforeAll, expect, test } from "bun:test";
import { startWorker } from "../scripts/local-worker";
import { releaseRecords, RELEASE_ID, PREVIOUS_ID } from "../tests/releases-fixture";
import { LOCALES, localizedPath } from "../src/lib/i18n";
import { releaseCopy } from "../../web/lib/i18n/dictionaries/releases";
import type { R2Bucket } from "../../web/lib/storage/r2-binding-store";

let worker: Awaited<ReturnType<typeof startWorker>>;
beforeAll(async () => { worker = await startWorker(releaseRecords(), { R2_PUBLIC_BASE_URL: "https://data.example.com" }); }, 30000);
afterAll(async () => { await worker?.dispose(); });
const get = async (path: string, method = "GET") => fetch(new URL(path, await worker.ready), { method, redirect: "manual" });

test("built release page renders all seven locales, evidence links and layer dates", async () => {
  for (const locale of LOCALES) {
    const path = localizedPath(locale, `/releases/${RELEASE_ID}`);
    const response = await get(path);
    const html = await response.text();
    expect(response.status).toBe(200);
    for (const label of ["title", "published", "tracked", "skipped", "dates", "records"] as const) expect(html).toContain(releaseCopy[locale][label]);
    expect(html).toContain(`href="${localizedPath(locale, `/releases/${PREVIOUS_ID}`)}"`);
    for (const key of [`views/${RELEASE_ID}/meta.json`, "views/latest.json", "ops/workflows/latest-success.json", "ops/workflows/health/workflow-refresh.json"]) expect(html).toContain(`href="https://data.example.com/${key}"`);
    for (const value of [RELEASE_ID, 'datetime="2026-10-25T05:12:00.000Z"', "2026-07-01", "2026-09", "2026-W42"]) expect(html).toContain(value);
    expect(html).toContain(`next=%2Freleases%2F${RELEASE_ID}`);
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    const head = await get(path, "HEAD");
    expect(head.status).toBe(200); expect(await head.text()).toBe("");
  }
}, 30000);
test("first release preserves missing fields and unknown release IDs return HTTP 404", async () => {
  for (const locale of ["en", "ja"] as const) {
    const first = await get(localizedPath(locale, `/releases/${PREVIOUS_ID}`));
    const html = await first.text();
    expect(first.status).toBe(200);
    expect(html).toContain(releaseCopy[locale].none);
    expect(html).toContain(releaseCopy[locale].unavailable);
    expect(html).toContain(releaseCopy[locale].noRecords);
    expect(html).not.toContain('href="https://data.example.com/views/latest.json"');
    expect((await get(localizedPath(locale, "/releases/unknown"))).status).toBe(404);
  }
});
test("release detail URLs bypass the page cache before and after history append in all locales", async () => {
  const id = "managed-2026-10-25";
  const paths = LOCALES.map((locale) => localizedPath(locale, `/releases/${id}`));
  const bucket = await worker.getR2Bucket("DATA") as unknown as R2Bucket;
  const original = releaseRecords().get("views/releases.json")!;
  try {
    for (const path of paths) {
      const response = await get(path);
      expect(response.status, path).toBe(404);
      expect(response.headers.get("x-gsc-cache"), path).toBe("BYPASS");
      await response.text();
    }
    const history = JSON.parse(original);
    history.releases.unshift({
      ...history.releases[0], id, prev_version: RELEASE_ID,
      published_at: "2026-10-26T05:12:00.000Z",
    });
    await bucket.put("views/releases.json", JSON.stringify(history));
    for (const path of paths) {
      const response = await get(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("x-gsc-cache"), path).toBe("BYPASS");
      expect(await response.text(), path).toContain(id);
    }
  } finally {
    await bucket.put("views/releases.json", original);
  }
}, 30000);
test("empty and absent release histories return HTTP 404", async () => {
  const bucket = await worker.getR2Bucket("DATA") as unknown as R2Bucket;
  await bucket.put("views/releases.json", '{"schema_ver":1,"releases":[]}');
  for (const prefix of ["", "/ja"]) expect((await get(`${prefix}/releases/${RELEASE_ID}?empty=1`)).status).toBe(404);
  await bucket.delete("views/releases.json");
  expect((await get(`/releases/${RELEASE_ID}?absent=1`)).status).toBe(404);
});
