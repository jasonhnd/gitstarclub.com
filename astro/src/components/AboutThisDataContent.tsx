import { createElement } from "react";
import type { Meta, ViewsPointer } from "../../../web/lib/contracts";
import type { Dict, Locale } from "../lib/i18n";
import { localizedPath, toBcp47Locale } from "../lib/i18n";

export type DataLayer = "currentTotals" | "periodGains" | "historyCurve";
export interface AboutThisDataProps {
  locale: Locale;
  dictionary: Dict;
  /** Metadata and release identity must come from the same captured publication. */
  meta: Meta | null;
  releaseId: ViewsPointer["version"] | null;
  layer: DataLayer;
  pageTitle: string;
  canonicalUrl: string;
  /** Supply only when the page actually uses this published daily history. */
  historyCoverage?: { start: string; end_inclusive: string };
}

const methods = {
  currentTotals: { text: "methodCurrentTotals", anchor: "current-totals" },
  periodGains: { text: "methodPeriodGains", anchor: "period-gains" },
  historyCurve: { text: "methodHistoryCurve", anchor: "history-curve" },
} as const;
const linkClass = "font-semibold text-readable-gold underline underline-offset-4 hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary";

/** Static content shared by Astro and the isolated acceptance render. No React hydration. */
export function AboutThisDataContent({ locale, dictionary, meta, releaseId, layer, pageTitle, canonicalUrl, historyCoverage }: AboutThisDataProps) {
  const t = dictionary.aboutData;
  const language = toBcp47Locale(locale);
  const formatDate = (value: string) => new Intl.DateTimeFormat(language, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value));
  const timestamp = meta?.generated_at ?? meta?.backfilled_at;
  const date = timestamp ? new Date(timestamp).toISOString().slice(0, 10) : null;
  const count = meta?.active_repo_count;
  const coverage = count === undefined ? t.coverageUnknown : t.coverageWithCount.replace("{count}", new Intl.NumberFormat(language).format(count));
  const method = methods[layer];
  const citation = t.citation.replace(/\{(title|url|date|release)\}/g, (_match, key: string) => ({ title: pageTitle, url: canonicalUrl, date: date ?? t.unavailable, release: releaseId ?? t.unavailable })[key]!);

  const rows = [
    [t.dataAsOf, <><span>{date ? <time dateTime={date}>{formatDate(date)}</time> : t.unavailable} ({t[layer]})</span>{historyCoverage && <span> · {t.dailyHistory.replace("{start}", formatDate(historyCoverage.start)).replace("{end}", formatDate(historyCoverage.end_inclusive))}</span>}</>],
    [t.coverage, coverage],
    [t.method, <>{t[method.text]} {" "}<a className={linkClass} href={`${localizedPath(locale, "/about")}#${method.anchor}`}>{t.methodLink}<span aria-hidden="true"> →</span></a></>],
    [t.citeAs, <><div className="flex flex-wrap items-start gap-3"><span data-citation tabIndex={0} className="min-w-0 flex-1 basis-64 select-text rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">{citation}</span><button type="button" hidden data-copy data-copied={t.copied} data-unavailable={t.copyUnavailable} className="min-h-11 rounded-full border border-outline-variant bg-surface-container-high px-4 py-2 font-semibold text-on-surface hover:bg-primary-container hover:text-on-primary-container focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">{t.copy}</button></div><span data-copy-status role="status" className="sr-only" /></>],
    [t.release, releaseId ? <a className={`${linkClass} font-mono`} href={`/releases/${encodeURIComponent(releaseId)}`}>{releaseId}<span aria-hidden="true"> →</span></a> : t.unavailable],
  ] as const;

  return (
    createElement("gsc-about-data", { className: "block" },
      <details className="my-8 rounded-xl border border-outline-variant bg-surface-container p-4 sm:p-6">
        <summary className="cursor-pointer rounded-sm text-base font-bold text-on-surface focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">{t.heading}</summary>
        <dl className="mt-5 grid gap-5 text-sm leading-relaxed text-on-surface-variant">
          {rows.map(([label, content]) => <div key={label} className="grid min-w-0 gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4"><dt className="font-semibold text-on-surface">{label}</dt><dd className="min-w-0 [overflow-wrap:anywhere]">{content}</dd></div>)}
        </dl>
      </details>
    )
  );
}
