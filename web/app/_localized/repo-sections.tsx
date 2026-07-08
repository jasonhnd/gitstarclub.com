import Link from "next/link";
import type { ReactNode } from "react";
import { ShareButton } from "@/app/_explore/ShareButton";
import { ShareableSnippet, type ShareableSnippetLabels } from "@/app/_explore/ShareableSnippet";
import { Star } from "@/app/_explore/Star";
import { StarCurve, type CurveInflection, type Milestone } from "@/app/_explore/StarCurve";
import type { RepoEntity } from "@/lib/contracts";
import { safeExternalHref } from "@/lib/external-url";
import { fmtStars, monthLabel, ymParts } from "@/lib/format";
import type { Dict, Locale } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/routing";
import type { ShareableSnippetContent } from "@/lib/shareable-snippets";
import { languageHref, type CategoryLink, type RelatedRepo, type RepoLanguage } from "@/lib/repo-page";

type RepoSeriesPoint = { label: string; total: number };

export function RepoHeroSection({
  created,
  languages,
  locale,
  repo,
  t,
}: {
  created: { y: number; m: number };
  languages: RepoLanguage[];
  locale: Locale;
  repo: RepoEntity;
  t: Dict;
}) {
  const href = (path: string) => localizedPath(locale, path);
  return (
    <header className="animate-rise">
      <h1 className="flex flex-wrap items-baseline gap-x-1 gap-y-1 font-mono text-[clamp(1.4rem,4vw,2.2rem)]">
        <span className="text-on-surface-variant">{repo.owner} /</span>
        <span className="font-semibold text-on-surface">{repo.name}</span>
      </h1>
      {repo.description && <p className="mt-3 max-w-[52ch] text-[clamp(1rem,1.7vw,1.2rem)] text-on-surface-variant">{repo.description}</p>}
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[0.8rem] text-on-surface-variant">
        <span className="text-readable-gold text-[1.6rem] font-extrabold tabular-nums">
          {fmtStars(repo.current_stars)}
          {" "}
          <Star />
        </span>
        {languages[0] && (
          <Link href={href(languageHref(languages[0].name))} className="text-tertiary hover:text-primary hover:underline hover:underline-offset-[3px]">
            {languages[0].name}
          </Link>
        )}
        <span>
          {t.repo.created} {monthLabel(locale, created.m, "short")} {created.y}
        </span>
        {repo.is_archived && <span className="text-tertiary">{t.repo.archived}</span>}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <ShareButton text={`${repo.full_name} — ${t.repo.starHistory}`} labels={t.share} />
        <Link
          href={href(`/compare?repos=${encodeURIComponent(repo.full_name)}`)}
          className="inline-flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-4 py-2 font-mono text-[0.78rem] text-on-surface transition-colors hover:bg-surface-container-high"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 18v-6m0 0V6m0 6h16m0 0v6m0-6V6" strokeLinecap="round" />
          </svg>
          {t.compare.addToCompare}
        </Link>
      </div>
    </header>
  );
}

export function RepoAboutAside({
  homepageHref,
  languageTotalSize,
  languages,
  locale,
  releaseHref,
  repo,
  t,
}: {
  homepageHref: string | null;
  languageTotalSize: number;
  languages: RepoLanguage[];
  locale: Locale;
  releaseHref: string | null;
  repo: RepoEntity;
  t: Dict;
}) {
  const href = (path: string) => localizedPath(locale, path);
  return (
    <aside className="rounded-2xl bg-surface-container px-4 py-4">
      <h2 className="font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">{t.repo.about}</h2>
      {repo.description && <p className="mt-3 text-[0.95rem] leading-relaxed text-on-surface">{repo.description}</p>}
      <dl className="mt-4 grid gap-3 text-[0.86rem]">
        <MetaRow label={t.repo.owner} value={repo.owner} href={href(`/o/${repo.owner}`)} />
        {languages.length > 0 && (
          <MetaRow
            label={languages.length > 1 ? t.repo.languages : t.repo.language}
            value={<LanguageLinks languages={languages} totalSize={languageTotalSize} locale={locale} />}
            wrap
          />
        )}
        {repo.license && <MetaRow label={t.repo.license} value={repo.license} />}
        {homepageHref && <MetaRow label={t.repo.homepage} value={homepageHref.replace(/^https?:\/\//i, "")} href={homepageHref} external />}
        <MetaRow
          label={t.repo.latestRelease}
          value={repo.latest_release ? repo.latest_release.name || repo.latest_release.tag_name : t.repo.noRelease}
          href={releaseHref ?? undefined}
          external={Boolean(releaseHref)}
        />
      </dl>
      {repo.topics.length > 0 && (
        <div className="mt-5">
          <h3 className="font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">{t.repo.topics}</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {repo.topics.slice(0, 12).map((topic) => (
              <span key={topic} className="rounded-full bg-surface-container-high px-2.5 py-1 font-mono text-[0.72rem] text-on-surface-variant">
                {topic}
              </span>
            ))}
          </div>
        </div>
      )}
      <a
        href={`https://github.com/${repo.full_name}`}
        rel="noreferrer"
        className="mt-5 inline-flex items-center gap-1 font-semibold text-tertiary transition-colors hover:text-primary hover:underline hover:underline-offset-[3px]"
      >
        {t.repo.github} →
      </a>
    </aside>
  );
}

export function RepoLinkHub({
  owner,
  categories,
  related,
  locale,
  t,
}: {
  owner: string;
  categories: CategoryLink[];
  related: RelatedRepo[];
  locale: Locale;
  t: Dict;
}) {
  const href = (path: string) => localizedPath(locale, path);
  return (
    <section aria-labelledby="repo-link-hub" className="mt-[clamp(1.75rem,3.5vw,2.5rem)] border-y border-outline-variant py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="repo-link-hub" className="text-[1.05rem] font-extrabold text-on-surface">
          {t.repo.relatedPages}
        </h2>
        <Link href={href("/categories")} className="text-readable-gold font-mono text-[0.78rem] hover:underline">
          {t.nav.categories}
        </Link>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,1.4fr)]">
        <div className="min-w-0">
          <p className="font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">{t.repo.owner}</p>
          <Link href={href(`/o/${owner}`)} className="text-readable-gold mt-2 inline-block max-w-full truncate font-mono text-[0.9rem] font-semibold hover:underline" title={owner}>
            /o/{owner}
          </Link>
        </div>
        {categories.length > 0 && (
          <div className="min-w-0">
            <p className="font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">{t.nav.categories}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {categories.map((category) => (
                <Link
                  key={category.id}
                  href={href(category.href)}
                  className="rounded-full bg-surface-container-high px-2.5 py-1 font-mono text-[0.72rem] text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary"
                >
                  {category.label}
                </Link>
              ))}
            </div>
          </div>
        )}
        {related.length > 0 && (
          <div className="min-w-0">
            <p className="font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">{t.repo.relatedRepositories}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {related.map((entry) => (
                <Link key={entry.full_name} href={href(`/${entry.full_name}`)} className="min-w-0 rounded-lg bg-surface-container-high px-3 py-2 transition-colors hover:bg-surface-container-highest">
                  <span className="block truncate font-mono text-[0.78rem] font-semibold text-on-surface" title={entry.full_name}>
                    {entry.owner}/{entry.name}
                  </span>
                  <span className="mt-1 block font-mono text-[0.68rem] text-on-surface-variant">
                    {fmtStars(entry.current_stars)}
                    <Star />
                    {entry.language ? ` · ${entry.language}` : ""}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export function RepoHistorySection({
  inflections,
  milestones,
  series,
  t,
}: {
  inflections: CurveInflection[];
  milestones: Milestone[];
  series: RepoSeriesPoint[];
  t: Dict;
}) {
  if (series.length <= 1) return null;
  return (
    <section className="mt-[clamp(2rem,4vw,3rem)]">
      <h2 className="mb-3 font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">{t.repo.history}</h2>
      <StarCurve series={series} milestones={milestones} inflections={inflections} labels={{ ariaLabel: t.a11y.starHistory }} />
    </section>
  );
}

export function RepoMilestonesSection({
  locale,
  milestoneSnippet,
  milestones,
  snippetLabels,
  t,
}: {
  locale: Locale;
  milestoneSnippet: ShareableSnippetContent | null;
  milestones: Milestone[];
  snippetLabels: ShareableSnippetLabels;
  t: Dict;
}) {
  if (milestones.length === 0) return null;
  const href = (path: string) => localizedPath(locale, path);
  return (
    <section className="mt-[clamp(2rem,4vw,3rem)]">
      <h2 className="mb-3 text-[1.2rem] font-extrabold tracking-tight text-on-surface">{t.repo.milestones}</h2>
      <ul className="flex flex-wrap gap-2">
        {milestones.map((milestone) => {
          const d = ymParts(milestone.date);
          return (
            <li key={milestone.stars}>
              <Link href={href(`/rankings/${d.y}/${d.m}`)} className="inline-flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-4 py-2 transition-colors hover:bg-surface-container-high">
                <span className="text-readable-gold font-extrabold">{milestone.label}</span>
                <span className="font-mono text-[0.8rem] text-on-surface-variant">
                  {monthLabel(locale, d.m, "short")} {d.y}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {milestoneSnippet && <ShareableSnippet snippet={milestoneSnippet} labels={snippetLabels} className="mt-4" />}
    </section>
  );
}

export function RepoRecentSection({ locale, monthly, t }: { locale: Locale; monthly: RepoEntity["monthly_table"]; t: Dict }) {
  if (monthly.length === 0) return null;
  const href = (path: string) => localizedPath(locale, path);
  return (
    <section className="mt-[clamp(2rem,4vw,3rem)]">
      <h2 className="mb-3 text-[1.2rem] font-extrabold tracking-tight text-on-surface">{t.repo.recent}</h2>
      <ul className="flex flex-col divide-y divide-outline-variant/50">
        {monthly.map((row) => {
          const d = ymParts(row.month);
          return (
            <li key={row.month}>
              <Link href={href(`/rankings/${d.y}/${d.m}`)} className="group grid grid-cols-1 items-start gap-y-1 py-3 transition-colors hover:bg-on-surface/5 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-4 sm:py-2.5">
                <span className="min-w-0 font-mono text-[0.9rem] text-on-surface group-hover:underline group-hover:underline-offset-2">
                  {monthLabel(locale, d.m, "short")} {d.y}
                </span>
                <span className="font-mono text-[0.78rem] tabular-nums text-on-surface-variant sm:text-[0.85rem]">
                  {row.rank != null ? <>{t.repo.rank} #{row.rank}</> : ""}
                </span>
                <span className="font-semibold tabular-nums text-on-surface sm:w-20 sm:text-right">+{fmtStars(row.adds)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LanguageLinks({ languages, totalSize, locale }: { languages: RepoLanguage[]; totalSize: number; locale: Locale }) {
  const total = totalSize || languages.reduce((sum, language) => sum + Math.max(0, language.size ?? 0), 0);
  return (
    <div className="flex flex-wrap gap-2">
      {languages.map((language) => {
        const share = total > 0 && language.size ? Math.round((language.size / total) * 1000) / 10 : null;
        return (
          <Link
            key={language.name}
            href={localizedPath(locale, languageHref(language.name))}
            className="inline-flex max-w-full items-center gap-2 rounded-full bg-surface-container-high px-2.5 py-1 font-mono text-[0.72rem] text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary"
          >
            {language.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: language.color }} aria-hidden="true" />}
            <span className="truncate">{language.name}</span>
            {share !== null && <span className="shrink-0 text-on-surface-variant">{share}%</span>}
          </Link>
        );
      })}
    </div>
  );
}

function MetaRow({
  label,
  value,
  href,
  external = false,
  wrap = false,
}: {
  label: ReactNode;
  value: ReactNode;
  href?: string;
  external?: boolean;
  wrap?: boolean;
}) {
  const safeHref = href && external ? safeExternalHref(href) ?? undefined : href;
  const valueNode = safeHref ? (
    <a href={safeHref} className="truncate font-semibold text-tertiary hover:text-primary hover:underline hover:underline-offset-[3px]" {...(external ? { rel: "noreferrer" } : {})}>
      {value}
    </a>
  ) : wrap ? (
    <div className="min-w-0">{value}</div>
  ) : (
    <span className="truncate font-semibold text-on-surface">{value}</span>
  );
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3">
      <dt className="font-mono text-on-surface-variant">{label}</dt>
      <dd className="min-w-0">{valueNode}</dd>
    </div>
  );
}
