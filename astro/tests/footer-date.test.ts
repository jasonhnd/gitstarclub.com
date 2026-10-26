import { describe, expect, test } from "bun:test";
import { startWorker } from "../scripts/local-worker";
import { p1FixtureRecords } from "./p1/fixture";
import { fixtureRecords } from "../scripts/fixture";
import { getDictionary, type Locale } from "../../web/lib/i18n";
import { localizedPath } from "../../web/lib/i18n/routing";
import { resolveDataAsOfLabel } from "../../web/lib/geo-capsules";

const publishedAt = "2026-07-17T00:00:00.000Z";

describe("footer data-through date", () => {
  test("home, a repository page, and rankings show the published date in en and ja", async () => {
    const worker = await startWorker(fixtureRecords("fixture-v1", publishedAt));
    try {
      const origin = (await worker.ready).origin;
      for (const locale of ["en", "ja"] as const satisfies readonly Locale[]) {
        const dictionary = await getDictionary(locale);
        const date = resolveDataAsOfLabel(publishedAt, { locale });
        expect(date).toBeTruthy();
        const label = `${dictionary.footer.dataThrough} ${date}`;
        for (const path of ["/", "/example/repo", "/rankings"]) {
          const url = origin + localizedPath(locale, path);
          const response = await fetch(url, { headers: { "accept-language": "en" } });
          const html = await response.text();
          expect(response.status, url).toBe(200);
          const footer = html.slice(html.lastIndexOf("<footer"));
          expect(footer.includes(label), `${url} footer`).toBe(true);
          const main = html.slice(html.indexOf("<main"), html.lastIndexOf("<footer"));
          expect(main.includes(date!), `${url} summary`).toBe(true);
        }
      }
    } finally {
      await worker.dispose();
    }
  });

  for (const hasRankings of [true, false]) {
    test(`summary dates override global metadata (rankings ${hasRankings ? "present" : "absent"})`, async () => {
      const globalDate = "2026-07-20T00:00:00.000Z";
      const snapshotDate = "2026-07-18T00:00:00.000Z";
      const rankingDate = "2026-07-16T00:00:00.000Z";
      const records = p1FixtureRecords();
      for (const [key, body] of records) {
        if (key.endsWith("meta.json")) {
          records.set(key, JSON.stringify({ ...JSON.parse(body), generated_at: globalDate }));
        } else if (key.endsWith("hot-snapshot.json")) {
          records.set(key, JSON.stringify({ ...JSON.parse(body), generated_at: snapshotDate }));
        } else if (key.includes("rank/")) {
          if (!hasRankings) records.delete(key);
          else {
            const rank = JSON.parse(body);
            rank.meta.generated_at = rankingDate;
            records.set(key, JSON.stringify(rank));
          }
        }
      }
      const worker = await startWorker(records);
      try {
        const origin = (await worker.ready).origin;
        for (const locale of ["en", "ja"] as const) {
          const dictionary = await getDictionary(locale);
          for (const [path, expectedDate] of [
            ["/", snapshotDate],
            ["/rankings", hasRankings ? rankingDate : snapshotDate],
            ["/about", globalDate],
          ]) {
            const url = origin + localizedPath(locale, path);
            const response = await fetch(url, { headers: { "accept-language": "en" } });
            const html = await response.text();
            expect(response.status, url).toBe(200);
            const date = resolveDataAsOfLabel(expectedDate, { locale })!;
            const footer = html.slice(html.lastIndexOf("<footer"));
            expect(footer.includes(`${dictionary.footer.dataThrough} ${date}`), `${url} footer`).toBe(true);
            if (path !== "/about") {
              const summary = html.match(/<div data-testid="answer-capsule-data-as-of">[\s\S]*?<\/div>/)?.[0];
              expect(summary?.includes(date), `${url} summary`).toBe(true);
              const globalLabel = resolveDataAsOfLabel(globalDate, { locale })!;
              expect(footer.includes(globalLabel), `${url} must not use global date`).toBe(false);
            }
          }
        }
      } finally {
        await worker.dispose();
      }
    });
  }
});
