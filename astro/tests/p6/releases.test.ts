import { expect, test } from "bun:test";
import { RELEASES_PATH, Releases, type ReleaseRecord } from "../../../web/lib/contracts";
import { dateLabel, formatInteger } from "../../../web/lib/format";
import { getDictionary, LOCALES } from "../../../web/lib/i18n";
import { localizedPath } from "../../../web/lib/i18n/routing";
import { isLongTail } from "../../../web/lib/workers-host/cache/policy";
import type { R2Bucket } from "../../../web/lib/storage/r2-binding-store";
import { startWorker } from "../../scripts/local-worker";
import { findRelease, releasePath, releasesNewestFirst } from "../../src/packages/p6/releases";

const older: ReleaseRecord = {
  id: "refresh-2026-10-21T21-01-25-223Z",
  published_at: "2026-10-21T22:08:08.586Z",
  prev_version: null,
  tracked_repo_count: 5669,
  skipped_repo_count: 2,
  data_as_of: { seam_date: "2026-10-21" },
};
const tiedLow: ReleaseRecord = { ...older, id: "refresh-tied-a", published_at: "2026-10-22T00:00:00.000Z", prev_version: older.id, tracked_repo_count: 5670, skipped_repo_count: 1 };
const tiedHigh: ReleaseRecord = { ...tiedLow, id: "refresh-tied-b", tracked_repo_count: 5671 };
const newer: ReleaseRecord = {
  id: "refresh-2026-10-25T11-36-27-410Z",
  published_at: "2026-10-25T13:01:02.673Z",
  prev_version: older.id,
  tracked_repo_count: 5687,
  skipped_repo_count: 0,
  data_as_of: { seam_date: "2026-10-21", generated_at: "2026-10-25T12:42:09.205Z", folded_through: { month: "2026-09", week: "2026-W40" } },
};

test("release rows sort newest first and unknown ids stay absent", () => {
  const history = Releases.parse({ schema_ver: 1, releases: [older, tiedHigh, newer, tiedLow] });
  expect(releasesNewestFirst(history).map((record) => record.id)).toEqual([newer.id, tiedLow.id, tiedHigh.id, older.id]);
  expect(findRelease(history, newer.id)?.tracked_repo_count).toBe(5687);
  expect(findRelease(history, "not-a-release")).toBeNull();
  expect(findRelease(null, newer.id)).toBeNull();
  expect(releasePath(newer.id)).toBe(`/releases/${newer.id}`);
  expect(isLongTail(`/releases/${newer.id}`)).toBe(false);
  expect(isLongTail("/ja/releases/not-a-release")).toBe(false);
});

test("every locale has its own releases copy", async () => {
  const english = await getDictionary("en");
  for (const locale of LOCALES) {
    const dictionary = await getDictionary(locale);
    expect(dictionary.meta.releasesTitle.length).toBeGreaterThan(0);
    expect(dictionary.meta.releasesDescription.length).toBeGreaterThan(0);
    expect(dictionary.footer.releases.length).toBeGreaterThan(0);
    expect(dictionary.about.refreshHistoryLink.length).toBeGreaterThan(0);
    for (const key of ["title", "lede", "empty", "missing", "columnId", "columnPublished", "columnPrevious", "columnTracked", "columnSkipped", "previousNone", "caption", "back"] as const) {
      expect(dictionary.releases[key].length, `${locale}.${key}`).toBeGreaterThan(0);
    }
    if (locale !== "en") {
      expect(dictionary.releases.title, locale).not.toBe(english.releases.title);
      expect(dictionary.releases.empty, locale).not.toBe(english.releases.empty);
      expect(dictionary.releases.columnPublished, locale).not.toBe(english.releases.columnPublished);
      expect(dictionary.footer.releases, locale).not.toBe(english.footer.releases);
    }
  }
  expect(dateLabel("en", newer.published_at, "long")).toBe("October 25, 2026");
  expect(dateLabel("ja", newer.published_at, "long")).toBe("2026年10月25日");
});

test("an appended release appears on the same list URL within 60 seconds", async () => {
  const worker = await startWorker();
  try {
    const origin = (await worker.ready).origin;
    const get = (path: string) => fetch(`${origin}${path}`, { redirect: "manual" });
    for (const locale of LOCALES) {
      const path = localizedPath(locale, "/releases");
      const dictionary = await getDictionary(locale);
      const before = await get(path);
      const beforeHtml = await before.text();
      expect(before.status, path).toBe(200);
      expect(before.headers.get("x-gsc-cache"), path).toBe("BYPASS");
      expect(beforeHtml, path).toContain(dictionary.releases.title);
      expect(beforeHtml, path).not.toContain(newer.id);
      const warm = await get(path);
      expect(warm.headers.get("x-gsc-cache"), path).toBe("BYPASS");
      expect(await warm.text(), path).not.toContain(newer.id);
    }

    const bucket = await worker.getR2Bucket("DATA") as unknown as R2Bucket;
    const appendedAt = Date.now();
    await bucket.put(RELEASES_PATH, JSON.stringify({ schema_ver: 1, releases: [older, newer] }));
    for (const locale of LOCALES) {
      const path = localizedPath(locale, "/releases");
      const after = await get(path);
      const html = await after.text();
      expect(Date.now() - appendedAt, path).toBeLessThan(60_000);
      expect(after.status, path).toBe(200);
      expect(after.headers.get("x-gsc-cache"), path).toBe("BYPASS");
      expect(html, path).toContain((await getDictionary(locale)).releases.title);
      expect(html, path).toContain(newer.id);
      expect(html.indexOf(newer.id), path).toBeLessThan(html.indexOf(older.id));
    }
  } finally {
    await worker.dispose();
  }
}, 120_000);

test("the releases page renders fixture rows, an empty history, and an unknown id", async () => {
  const worker = await startWorker();
  try {
    const origin = (await worker.ready).origin;
    const get = (path: string) => fetch(`${origin}${path}`, { redirect: "manual" });
    const english = await getDictionary("en");
    const japanese = await getDictionary("ja");

    const empty = await get("/releases?case=empty");
    const emptyHtml = await empty.text();
    expect(empty.status).toBe(200);
    expect(empty.headers.get("x-robots-tag")).toContain("noindex");
    expect(emptyHtml).toContain('content="noindex, nofollow"');
    expect(emptyHtml).toContain(english.releases.empty);
    expect(emptyHtml).not.toContain(newer.id);
    expect(emptyHtml).toContain(`href="${localizedPath("en", "/releases")}"`);

    const emptyJa = await get("/ja/releases?case=empty");
    expect(emptyJa.status).toBe(200);
    expect(await emptyJa.text()).toContain(japanese.releases.empty);

    const absentDetail = await get(`/releases/${newer.id}?case=empty`);
    expect(absentDetail.status).toBe(404);
    expect(await absentDetail.text()).toContain(english.releases.missing);

    const bucket = await worker.getR2Bucket("DATA") as unknown as R2Bucket;
    await bucket.put(RELEASES_PATH, JSON.stringify({ schema_ver: 1, releases: [older, newer] }));

    const listed = await get("/releases?case=rows");
    const listedHtml = await listed.text();
    expect(listed.status).toBe(200);
    expect(listedHtml).toContain(english.releases.columnTracked);
    expect(listedHtml).toContain(english.releases.columnSkipped);
    expect(listedHtml.indexOf(newer.id)).toBeLessThan(listedHtml.indexOf(older.id));
    expect(listedHtml).toContain(`href="${releasePath(newer.id)}"`);
    expect(listedHtml).toContain(newer.published_at);
    expect(listedHtml).toContain("October 25, 2026");
    expect(listedHtml).toContain(formatInteger("en", newer.tracked_repo_count));
    expect(listedHtml).toContain(formatInteger("en", older.skipped_repo_count));
    expect(listedHtml).toContain(english.releases.previousNone);
    expect(listedHtml).toContain(english.footer.releases);

    const listedJa = await get("/ja/releases?case=rows");
    const jaHtml = await listedJa.text();
    expect(listedJa.status).toBe(200);
    expect(jaHtml).toContain(`lang="ja"`);
    expect(jaHtml).toContain(japanese.releases.title);
    expect(jaHtml).toContain("2026年10月25日");
    expect(jaHtml).toContain(formatInteger("ja", newer.tracked_repo_count));
    expect(jaHtml).toContain(`href="${localizedPath("ja", releasePath(newer.id))}"`);
    expect(jaHtml).toContain(japanese.releases.previousNone);
    expect(jaHtml).toContain(japanese.footer.releases);

    for (const locale of LOCALES) {
      const dictionary = await getDictionary(locale);
      const response = await get(`${localizedPath(locale, "/releases")}?case=locales`);
      const html = await response.text();
      expect(response.status, locale).toBe(200);
      expect(html, locale).toContain(dictionary.releases.title);
      expect(html, locale).toContain(dictionary.releases.columnPrevious);
      expect(html, locale).toContain(dictionary.footer.releases);
      expect(html, locale).toContain("noindex, nofollow");
    }

    const detail = await get(`${releasePath(newer.id)}?case=detail`);
    const detailHtml = await detail.text();
    expect(detail.status).toBe(200);
    expect(detailHtml).toContain(newer.id);
    expect(detailHtml).toContain(newer.published_at);
    expect(detailHtml).toContain("October 25, 2026");
    expect(detailHtml).toContain(`href="${releasePath(older.id)}"`);
    expect(detailHtml).toContain(formatInteger("en", 5687));
    expect(detailHtml).toContain(english.releases.back);

    const detailJa = await get(`${localizedPath("ja", releasePath(older.id))}?case=detail`);
    const detailJaHtml = await detailJa.text();
    expect(detailJa.status).toBe(200);
    expect(detailJaHtml).toContain(japanese.releases.previousNone);
    expect(detailJaHtml).toContain(formatInteger("ja", 5669));
    expect(detailJaHtml).toContain(`href="${localizedPath("ja", "/releases")}"`);

    const unknown = await get("/releases/not-a-release?case=unknown");
    const unknownHtml = await unknown.text();
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("x-robots-tag")).toContain("noindex");
    expect(unknownHtml).toContain(english.releases.missing);
    expect(unknownHtml).toContain("not-a-release");
    expect(unknownHtml).not.toContain("The page may have moved");
    expect(unknownHtml).not.toContain(newer.id);

    const unknownJa = await get("/ja/releases/not-a-release?case=unknown");
    expect(unknownJa.status).toBe(404);
    expect(await unknownJa.text()).toContain(japanese.releases.missing);

    const about = await get("/about?case=link");
    const aboutHtml = await about.text();
    expect(about.status).toBe(200);
    expect(aboutHtml).toContain(english.about.refreshHistoryLink);
    expect(aboutHtml).toContain('href="/releases"');
    const aboutJa = await get("/ja/about?case=link");
    const aboutJaHtml = await aboutJa.text();
    expect(aboutJaHtml).toContain(japanese.about.refreshHistoryLink);
    expect(aboutJaHtml).toContain('href="/ja/releases"');

    await bucket.delete(RELEASES_PATH);
    const removed = await get("/releases?case=removed");
    expect(removed.status).toBe(200);
    expect(await removed.text()).toContain(english.releases.empty);
  } finally {
    await worker.dispose();
  }
}, 120_000);
