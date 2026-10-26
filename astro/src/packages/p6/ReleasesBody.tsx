import Link from "../../components/Link";
import { PageHero } from "@/app/_explore/PageHero";
import { PAD_X } from "@/app/_explore/layout-tokens";
import type { ReleaseRecord, Releases } from "@/lib/contracts";
import { dateLabel, formatInteger } from "@/lib/format";
import type { Dict, Locale } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/routing";
import { releasePath, releasesNewestFirst } from "./releases";

const linkClass = "break-all font-mono font-semibold text-on-surface hover:underline hover:underline-offset-2 md:whitespace-nowrap";
const labelClass = "font-mono text-[0.68rem] uppercase tracking-wider text-on-surface-variant";
const cellClass = "bg-surface-container px-3 py-3 align-top text-[0.86rem] text-on-surface";

function PublishedTime({ locale, value }: { locale: Locale; value: string }) {
  return (
    <>
      <time dateTime={value} className="block font-mono text-[0.78rem] text-on-surface md:whitespace-nowrap">{value} UTC</time>
      <span className="mt-1 block text-[0.82rem] text-on-surface-variant">{dateLabel(locale, value, "long")}</span>
    </>
  );
}

function PreviousVersion({ locale, dictionary: t, value }: { locale: Locale; dictionary: Dict; value: string | null }) {
  if (!value) return <span>{t.releases.previousNone}</span>;
  return <Link href={localizedPath(locale, releasePath(value))} className={linkClass}>{value}</Link>;
}

function Count({ locale, value }: { locale: Locale; value: number }) {
  return <span className="tabular-nums">{formatInteger(locale, value)}</span>;
}

export function ReleasesBody({ locale, dictionary: t, history }: { locale: Locale; dictionary: Dict; history: Releases | null }) {
  const rows = history ? releasesNewestFirst(history) : [];
  const href = (path: string) => localizedPath(locale, path);
  return (
    <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[72rem] flex-1 py-[clamp(1.75rem,4.5vw,4rem)] ${PAD_X}`}>
      <PageHero animateTitle={false} eyebrow={t.releases.eyebrow} title={t.releases.title} lede={t.releases.lede} />
      {rows.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-dashed border-outline-variant bg-surface-container px-4 py-4 text-[0.95rem] text-on-surface-variant" role="status">{t.releases.empty}</p>
      ) : (
        <>
          <ol className="mt-8 grid gap-3 md:hidden">
            {rows.map((record) => (
              <li key={record.id} className="rounded-2xl bg-surface-container px-4 py-4">
                <ReleaseFacts locale={locale} dictionary={t} record={record} href={href} />
              </li>
            ))}
          </ol>
          <div className="mt-8 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[64rem] border-separate border-spacing-y-2 text-left">
              <caption className="mb-2 text-left font-mono text-[0.75rem] uppercase tracking-wider text-on-surface-variant">{t.releases.caption}</caption>
              <thead>
                <tr>
                  <th scope="col" className={labelClass}>{t.releases.columnId}</th>
                  <th scope="col" className={labelClass}>{t.releases.columnPublished}</th>
                  <th scope="col" className={labelClass}>{t.releases.columnPrevious}</th>
                  <th scope="col" className={`${labelClass} text-right`}>{t.releases.columnTracked}</th>
                  <th scope="col" className={`${labelClass} text-right`}>{t.releases.columnSkipped}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((record) => (
                  <tr key={record.id}>
                    <th scope="row" className={`${cellClass} rounded-l-xl font-normal`}><Link href={href(releasePath(record.id))} className={linkClass}>{record.id}</Link></th>
                    <td className={cellClass}><PublishedTime locale={locale} value={record.published_at} /></td>
                    <td className={cellClass}><PreviousVersion locale={locale} dictionary={t} value={record.prev_version} /></td>
                    <td className={`${cellClass} text-right`}><Count locale={locale} value={record.tracked_repo_count} /></td>
                    <td className={`${cellClass} rounded-r-xl text-right`}><Count locale={locale} value={record.skipped_repo_count} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}

function ReleaseFacts({ locale, dictionary: t, record, href }: { locale: Locale; dictionary: Dict; record: ReleaseRecord; href: (path: string) => string }) {
  const facts = [
    { label: t.releases.columnPublished, value: <PublishedTime locale={locale} value={record.published_at} /> },
    { label: t.releases.columnPrevious, value: <PreviousVersion locale={locale} dictionary={t} value={record.prev_version} /> },
    { label: t.releases.columnTracked, value: <Count locale={locale} value={record.tracked_repo_count} /> },
    { label: t.releases.columnSkipped, value: <Count locale={locale} value={record.skipped_repo_count} /> },
  ];
  return (
    <article>
      <h2 className={labelClass}>{t.releases.columnId}</h2>
      <p className="mt-1"><Link href={href(releasePath(record.id))} className={linkClass}>{record.id}</Link></p>
      <dl className="mt-3 grid gap-3">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt className={labelClass}>{fact.label}</dt>
            <dd className="mt-1 text-[0.9rem] text-on-surface">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export function ReleaseDetailBody({
  locale, dictionary: t, record, requestedId,
}: {
  locale: Locale;
  dictionary: Dict;
  record: ReleaseRecord | null;
  requestedId: string;
}) {
  const href = (path: string) => localizedPath(locale, path);
  const shownId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,160}$/.test(requestedId) ? requestedId : null;
  return (
    <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[72rem] flex-1 py-[clamp(1.75rem,4.5vw,4rem)] ${PAD_X}`}>
      {record ? (
        <>
          <PageHero
            animateTitle={false}
            eyebrow={t.releases.eyebrow}
            title={<span className="break-all">{record.id}</span>}
            lede={`${record.published_at} UTC · ${dateLabel(locale, record.published_at, "long")}`}
          />
          <dl className="mt-8 grid max-w-[68ch] gap-4 rounded-2xl bg-surface-container px-4 py-4">
            <div>
              <dt className={labelClass}>{t.releases.columnPrevious}</dt>
              <dd className="mt-1"><PreviousVersion locale={locale} dictionary={t} value={record.prev_version} /></dd>
            </div>
            <div>
              <dt className={labelClass}>{t.releases.columnTracked}</dt>
              <dd className="mt-1"><Count locale={locale} value={record.tracked_repo_count} /></dd>
            </div>
            <div>
              <dt className={labelClass}>{t.releases.columnSkipped}</dt>
              <dd className="mt-1"><Count locale={locale} value={record.skipped_repo_count} /></dd>
            </div>
          </dl>
        </>
      ) : (
        <>
          <PageHero animateTitle={false} eyebrow={t.releases.eyebrow} title={t.releases.title} lede={t.releases.missing} />
          {shownId ? <p className="mt-6 break-all font-mono text-[0.9rem] text-on-surface">{shownId}</p> : null}
        </>
      )}
      <p className="mt-8">
        <Link href={href("/releases")} className="font-semibold text-tertiary hover:text-primary hover:underline hover:underline-offset-[3px]">{t.releases.back}</Link>
      </p>
    </main>
  );
}
