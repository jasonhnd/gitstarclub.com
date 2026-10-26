import type { ExportManifest } from "../../../../web/lib/data-exports";
import { formatDataAsOf } from "../../../../web/lib/geo-capsules";
import { intlLocaleTag } from "../../../../web/lib/format";
import type { Dict } from "../../../../web/lib/i18n";

declare const __GSC_EXPORT_MANIFEST__: ExportManifest | null;

export type ExportDownloadLink = { href: string; label: string };

export type ExportDownloadItem = {
  id: string;
  rows: number | null;
  exportDate: string;
  dataAsOf: string;
  detail: string;
  links: ExportDownloadLink[];
};

export type ExportDownloadModel = {
  exportDate: string | null;
  dataAsOf: string | null;
  mismatchNote: string | null;
  items: ExportDownloadItem[];
};

/** Manifest inlined at build from data/exports/v1/<date>/manifest.json. Absent in unit tests. */
export function publishedExportManifest(): ExportManifest | null {
  if (typeof __GSC_EXPORT_MANIFEST__ === "undefined" || __GSC_EXPORT_MANIFEST__ == null) return null;
  return isExportManifest(__GSC_EXPORT_MANIFEST__) ? __GSC_EXPORT_MANIFEST__ : null;
}

export function calendarDay(value: string | null | undefined): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value ?? "");
  return match?.[1] ?? null;
}

export function exportDownloadModel(
  manifest: ExportManifest | null,
  pageDataAsOf: string | null,
  locale: string,
  t: Dict,
): ExportDownloadModel {
  if (!manifest || !isExportManifest(manifest)) {
    return { exportDate: null, dataAsOf: null, mismatchNote: null, items: [] };
  }
  const exportDate = calendarDay(manifest.export_date) ?? calendarDay(manifest.data_as_of);
  const dataAsOf = typeof manifest.data_as_of === "string" ? manifest.data_as_of : null;
  const dateLabel = formatDataAsOf(exportDate, locale);
  const asOfDay = calendarDay(dataAsOf);
  const asOfLabel = formatDataAsOf(dataAsOf, locale);
  const shownDate = dateLabel && asOfLabel && exportDate && asOfDay && exportDate !== asOfDay
    ? `${dateLabel} · ${t.common.dataAsOf} ${asOfLabel}`
    : dateLabel ?? asOfLabel ?? "";
  const pageDay = calendarDay(pageDataAsOf);
  const mismatchNote = pageDay && exportDate && pageDay !== exportDate && dateLabel
    ? t.about.downloadExportedOn.replaceAll("{date}", dateLabel)
    : null;
  const items: ExportDownloadItem[] = [];
  if (exportDate && shownDate) {
    items.push({
      id: "manifest",
      rows: null,
      exportDate,
      dataAsOf: dataAsOf ?? exportDate,
      detail: shownDate,
      links: [{ href: "/data/exports/v1/latest/manifest.json", label: t.about.exportManifest }],
    });
  }
  for (const file of manifest.files) {
    if (!file || typeof file.name !== "string" || typeof file.rows !== "number" || !Number.isFinite(file.rows)) continue;
    const links = fileLinks(file, t);
    if (links.length === 0 || !exportDate || !shownDate) continue;
    const count = new Intl.NumberFormat(intlLocaleTag(locale)).format(file.rows);
    const rows = t.about.downloadRowCount.replaceAll("{count}", count);
    items.push({
      id: file.name,
      rows: file.rows,
      exportDate,
      dataAsOf: dataAsOf ?? exportDate,
      detail: t.about.downloadFileMeta.replaceAll("{date}", shownDate).replaceAll("{rows}", rows),
      links,
    });
  }
  return { exportDate, dataAsOf, mismatchNote, items };
}

function fileLinks(file: ExportManifest["files"][number], t: Dict): ExportDownloadLink[] {
  const links: ExportDownloadLink[] = [];
  const csv = file.latest_urls?.csv;
  const json = file.latest_urls?.json;
  if (csv) links.push({ href: csv, label: csvLabel(file.name, file.title, t) });
  if (json) links.push({ href: json, label: t.common.json });
  return links;
}

function csvLabel(name: string, title: string, t: Dict): string {
  if (name === "top-rankings") return t.about.topRankingsCsv;
  if (name === "top-repo-milestones") return t.about.repoMilestonesCsv;
  if (name === "top-org-aggregates") return t.about.orgAggregatesCsv;
  return title ? `${title} CSV` : `${name}.csv`;
}

function isExportManifest(value: unknown): value is ExportManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as ExportManifest;
  return typeof manifest.export_date === "string" && typeof manifest.data_as_of === "string" && Array.isArray(manifest.files);
}
