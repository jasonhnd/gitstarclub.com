import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { exportDownloadModel } from "../../src/packages/p6/export-downloads";
import type { ExportManifest } from "../../../web/lib/data-exports";
import { getDictionary, LOCALES } from "../../../web/lib/i18n";
import { formatDataAsOf } from "../../../web/lib/geo-capsules";

const fixtureManifest: ExportManifest = {
  schema_version: 1,
  export_date: "2026-09-06",
  data_as_of: "2026-09-06T06:37:28.831Z",
  license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  attribution: "Data from GH Archive, derived by GitStarClub.",
  generated_from: "fixture",
  limits: { topRankingRowsPerList: 50, milestoneSourceRepos: 100, orgRows: 50 },
  files: [
    {
      name: "top-rankings",
      title: "GitStarClub top repository rankings",
      formats: ["json", "csv"],
      rows: 100,
      source_views: ["rank/month/2026-08/repo/flow.json"],
      latest_urls: { json: "/data/exports/v1/latest/top-rankings.json", csv: "/data/exports/v1/latest/top-rankings.csv" },
      dated_urls: { json: "/data/exports/v1/2026-09-06/top-rankings.json", csv: "/data/exports/v1/2026-09-06/top-rankings.csv" },
    },
    {
      name: "top-repo-milestones",
      title: "milestones",
      formats: ["json", "csv"],
      rows: 97,
      source_views: [],
      latest_urls: { json: "/data/exports/v1/latest/top-repo-milestones.json", csv: "/data/exports/v1/latest/top-repo-milestones.csv" },
      dated_urls: { json: "/data/exports/v1/2026-09-06/top-repo-milestones.json", csv: "/data/exports/v1/2026-09-06/top-repo-milestones.csv" },
    },
    {
      name: "top-org-aggregates",
      title: "orgs",
      formats: ["json", "csv"],
      rows: 50,
      source_views: [],
      latest_urls: { json: "/data/exports/v1/latest/top-org-aggregates.json", csv: "/data/exports/v1/latest/top-org-aggregates.csv" },
      dated_urls: { json: "/data/exports/v1/2026-09-06/top-org-aggregates.json", csv: "/data/exports/v1/2026-09-06/top-org-aggregates.csv" },
    },
  ],
};

test("download listing reads export date, data as of, and row counts from a fixture manifest", async () => {
  const t = await getDictionary("en");
  const pageDate = "2026-10-25T04:00:34.331Z";
  const model = exportDownloadModel(fixtureManifest, pageDate, "en", t);
  expect(model.exportDate).toBe("2026-09-06");
  expect(model.dataAsOf).toBe("2026-09-06T06:37:28.831Z");
  expect(model.mismatchNote).toBe("This download was exported on September 6, 2026.");
  expect(model.items.map((item) => [item.id, item.rows, item.detail])).toEqual([
    ["manifest", null, "September 6, 2026"],
    ["top-rankings", 100, "September 6, 2026 · 100 rows"],
    ["top-repo-milestones", 97, "September 6, 2026 · 97 rows"],
    ["top-org-aggregates", 50, "September 6, 2026 · 50 rows"],
  ]);
  expect(model.items[1]?.links.map((link) => link.href)).toEqual([
    "/data/exports/v1/latest/top-rankings.csv",
    "/data/exports/v1/latest/top-rankings.json",
  ]);

  const sameDay = exportDownloadModel(fixtureManifest, "2026-09-06T01:02:03.000Z", "en", t);
  expect(sameDay.mismatchNote).toBeNull();
  expect(exportDownloadModel(fixtureManifest, null, "en", t).mismatchNote).toBeNull();

  const shifted = {
    ...fixtureManifest,
    data_as_of: "2026-09-05T23:00:00.000Z",
  };
  const shiftedModel = exportDownloadModel(shifted, pageDate, "en", t);
  expect(shiftedModel.items[1]?.detail).toBe("September 6, 2026 · Data as of September 5, 2026 · 100 rows");
});

test("download mismatch note and row counts are localized in every locale", async () => {
  for (const locale of LOCALES) {
    const t = await getDictionary(locale);
    const model = exportDownloadModel(fixtureManifest, "2026-10-25T00:00:00.000Z", locale, t);
    const date = formatDataAsOf("2026-09-06", locale);
    expect(date).toBeTruthy();
    expect(model.mismatchNote).toBe(t.about.downloadExportedOn.replaceAll("{date}", date!));
    expect(model.items.find((item) => item.id === "top-rankings")?.detail).toContain("100");
    expect(model.items.find((item) => item.id === "top-repo-milestones")?.rows).toBe(97);
    if (locale !== "en") expect(model.mismatchNote).not.toBe("This download was exported on September 6, 2026.");
  }
});

test("the checked-in export manifest drives dates and row counts without a second copy of those numbers", async () => {
  const t = await getDictionary("en");
  const root = new URL("../../../web/public/data/exports/v1/", import.meta.url);
  const dates = readdirSync(root).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name));
  expect(dates.length).toBeGreaterThan(0);
  for (const date of dates) {
    const manifest = JSON.parse(readFileSync(new URL(`${date}/manifest.json`, root), "utf8")) as ExportManifest;
    const later = "2026-10-25T00:00:00.000Z";
    const model = exportDownloadModel(manifest, later, "en", t);
    expect(model.exportDate).toBe(manifest.export_date);
    expect(model.dataAsOf).toBe(manifest.data_as_of);
    expect(model.mismatchNote).toBe(`This download was exported on ${formatDataAsOf(manifest.export_date, "en")}.`);
    expect(model.items.filter((item) => item.rows != null).map((item) => [item.id, item.rows])).toEqual(
      manifest.files.map((file) => [file.name, file.rows]),
    );
  }
  const current = JSON.parse(readFileSync(new URL(`${dates.sort().at(-1)}/manifest.json`, root), "utf8")) as ExportManifest;
  expect(exportDownloadModel(current, current.data_as_of, "en", t).mismatchNote).toBeNull();
});
