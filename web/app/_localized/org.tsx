import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Chrome } from "@/app/_explore/Chrome";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { FaqBlock } from "@/app/_explore/FaqBlock";
import { JsonLd } from "@/app/_explore/JsonLd";
import { PageHero } from "@/app/_explore/PageHero";
import { RelatedPages } from "@/app/_explore/RelatedPages";
import { StarCurve } from "@/app/_explore/StarCurve";
import { Star } from "@/app/_explore/Star";
import type { Row } from "@/app/_explore/RankingList";
import { RepositoryRankingTable } from "@/app/_explore/SemanticDataTable";
import { ShareButton } from "@/app/_explore/ShareButton";
import { ShareableSnippet } from "@/app/_explore/ShareableSnippet";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { DAILY_BASE_VIEW_TTL_MS, getMeta, getOrgEntityDaily, getReposLookupDaily } from "@/lib/data";
import type { OrgEntity } from "@/lib/contracts";
import { dateLabel, formatInteger, fmtStars } from "@/lib/format";
import { pageMeta } from "@/lib/seo";
import { orgLd, type FaqItem } from "@/lib/jsonld";
import { ANSWER_CAPSULE_SOURCE, resolveDataAsOfFromMeta, resolveDataAsOfValue, type AnswerCapsuleContent } from "@/lib/geo-capsules";
import { absoluteSnippetUrl, type ShareableSnippetContent } from "@/lib/shareable-snippets";
import { getDictionary, type Dict, type Locale } from "@/lib/i18n";
import { localizedPath, toBcp47Locale } from "@/lib/i18n/routing";
import { repositoryTableLabels } from "./routing";

const ORG_HERO_ACTION_CLASS =
  "text-readable-gold rounded-full border border-outline-variant bg-surface-container px-3 py-2 font-mono text-[0.78rem] transition-colors hover:bg-surface-container-high hover:underline";

export async function generateOrgMetadata({ locale, login: raw }: { locale: Locale; login: string }): Promise<Metadata> {
  const t = await getDictionary(locale);
  const language = toBcp47Locale(locale);
  const login = decodeURIComponent(raw);
  const org = await getOrgEntityDaily(login);
  if (!org) {
    return pageMeta({
      title: `${login} — ${t.org.starRanking}`,
      description: fill(t.org.metaFallbackDescription, { login }),
      path: `/o/${login}`,
      locale,
    });
  }
  const kind = org.owner_type === "Organization" ? t.org.organization : t.org.developer;
  return pageMeta({
    title: fill(t.org.metaTitle, { login: org.login, kind }),
    description: fill(t.org.metaDescription, {
      login: org.login,
      repos: org.repo_count.toLocaleString(language),
      stars: org.current_stars_sum.toLocaleString(language),
    }),
    path: `/o/${org.login}`,
    locale,
  });
}

export async function OrgPageView({ locale, login: raw }: { locale: Locale; login: string }) {
  const t = await getDictionary(locale);
  const language = toBcp47Locale(locale);
  const login = decodeURIComponent(raw);
  const [org, lookup, meta] = await Promise.all([getOrgEntityDaily(login), getReposLookupDaily(), getMeta(DAILY_BASE_VIEW_TTL_MS)]);
  if (!org) notFound();

  const series = org.curve.monthly.map(([period, , totalEnd]) => ({ label: period, total: totalEnd }));
  const asOf = resolveDataAsOfFromMeta(meta, org.curve.recent_daily.at(-1)?.[0], org.curve.monthly.at(-1)?.[0], { locale });
  const capsule = asOf ? buildLocalizedOrgCapsule(t, language, org, asOf) : null;
  const members: Row[] = org.members
    .map((id) => {
      const m = lookup?.[String(id)];
      return m ? { owner: m.owner, name: m.name, lang: m.language, total: m.current_stars } : null;
    })
    .filter((r): r is Row => r !== null)
    .sort((a, b) => b.total - a.total);
  const snippet = buildLocalizedOrgTotalSnippet({ t, locale, org, asOf, members });
  const faqItems = buildLocalizedOrgFaqs(t, language, org, members, asOf);
  const pagePath = `/o/${org.login}`;
  const routePath = localizedPath(locale, pagePath);
  const dateModified = resolveDataAsOfValue(
    meta?.generated_at,
    meta?.backfilled_at,
    meta?.folded_through?.month,
    org.curve.recent_daily.at(-1)?.[0],
    org.curve.monthly.at(-1)?.[0],
  );
  const repoLabels = repositoryTableLabels(t);
  const ownerType = orgOwnerTypeLabel(t, org.owner_type);
  const shareText = fill(t.org.metaTitle, { login: org.login, kind: ownerType });
  const shareUrl = absoluteSnippetUrl(routePath);
  const githubUrl = `https://github.com/${encodeURIComponent(org.login)}`;
  const heroLede = fill(t.org.metaDescription, {
    login: org.login,
    repos: formatInteger(language, org.repo_count),
    stars: formatInteger(language, org.current_stars_sum),
  });
  const trendSummary = buildOrgTrendSummary(t, org, language);
  const recentMovement = [...org.curve.recent_daily].slice(-7).reverse();
  const relatedItems = [
    relatedItem(localizedPath(locale, "/rankings"), t.rankings.title),
    relatedItem(localizedPath(locale, "/o"), t.org.indexTitle),
    ...members.slice(0, 4).map((row) => relatedItem(localizedPath(locale, `/${repoName(row)}`), repoName(row))),
  ];
  const capsuleLabels = { ariaLabel: t.common.answerCapsule, eyebrow: t.common.answerCapsule, dataAsOf: t.common.dataAsOf, source: t.common.source };
  const snippetLabels = {
    eyebrow: t.share.snippet,
    copy: t.share.copy,
    copied: t.share.copied,
    embed: t.share.embed,
    embedCopied: t.share.embedCopied,
  };

  return (
    <>
      <Chrome locale={locale} canonicalPath={pagePath} dictionary={t} />
      <JsonLd data={orgLd(org, routePath, language, { dateModified })} />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[72rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs locale={locale} dictionary={t} items={[{ path: "nav.home", href: "/" }, { label: org.login }]} />

        <PageHero
          className="mt-4"
          eyebrow={ownerType}
          title={<span className="break-all">{org.login}</span>}
          lede={heroLede}
          actions={
            <>
              <a href={githubUrl} rel="noreferrer" className={ORG_HERO_ACTION_CLASS}>
                {t.org.openGitHub}
              </a>
              <ShareButton text={shareText} url={shareUrl} labels={t.share} />
            </>
          }
          aside={
            <OrgHeroStats
              aggregateStars={fmtStars(org.current_stars_sum, locale)}
              dataAsOf={asOf}
              githubLabel={`github.com/${org.login}`}
              githubUrl={githubUrl}
              locale={locale}
              ownerType={ownerType}
              repoCount={org.repo_count}
              t={t}
            />
          }
        />

        {capsule && <AnswerCapsule capsule={capsule} labels={capsuleLabels} className="mt-[clamp(1.75rem,3.5vw,2.5rem)]" />}
        {snippet && <ShareableSnippet snippet={snippet} labels={snippetLabels} className="mt-[clamp(1.75rem,3.5vw,2.5rem)]" />}

        <section className="mt-[clamp(2rem,4vw,3rem)]">
          <div className="mb-3 max-w-[64ch]">
            <h2 className="font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">{t.org.history}</h2>
            {trendSummary && (
              <p className="mt-2 text-[0.95rem] leading-relaxed text-on-surface-variant">
                <span className="font-semibold text-on-surface">{t.org.chartSummary}:</span> {trendSummary}
              </p>
            )}
          </div>
          {series.length > 1 ? (
            <StarCurve series={series} milestones={[]} labels={{ ariaLabel: t.a11y.starHistory }} locale={locale} />
          ) : (
            <EmptyState message={t.org.trendUnavailable} className="mt-0" />
          )}
        </section>

        <section className="mt-[clamp(2rem,4vw,3rem)]">
          <h2 className="mb-3 text-[1.2rem] font-extrabold tracking-tight text-on-surface">
            {t.org.repos}
          </h2>
          {members.length > 0 ? (
            <>
              <MobileTrackedRepositoryCards rows={members} labels={repoLabels} locale={locale} />
              <div className="hidden md:block">
                <RepositoryRankingTable
                  rows={members}
                  variant="total"
                  locale={locale}
                  caption={fill(t.org.memberTableCaption, { login: org.login })}
                  labels={repoLabels}
                />
              </div>
            </>
          ) : (
            <EmptyState message={t.org.noTrackedRepos} />
          )}
        </section>

        {recentMovement.length > 0 && (
          <section className="mt-[clamp(2rem,4vw,3rem)]">
            <div className="mb-3 max-w-[64ch]">
              <h2 className="text-[1.2rem] font-extrabold tracking-tight text-on-surface">{t.org.recentMovement}</h2>
              <p className="mt-1 text-[0.9rem] text-on-surface-variant">{t.org.recentMovementDescription}</p>
            </div>
            <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {recentMovement.map(([date, adds]) => (
                <li key={date} className="rounded-lg bg-surface-container px-4 py-3">
                  <span className="block font-mono text-[0.72rem] text-on-surface-variant">{dateLabel(locale, date)}</span>
                  <span className={`mt-1 block font-mono text-[1rem] font-extrabold tabular-nums ${adds >= 0 ? "text-readable-gold" : "text-on-surface"}`}>
                    {signedStars(adds, locale)}
                    <Star />
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <RelatedPages title={t.org.relatedTitle} description={t.org.relatedDescription} items={relatedItems} />

        <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
      </main>
    </>
  );
}

function OrgHeroStats({
  aggregateStars,
  dataAsOf,
  githubLabel,
  githubUrl,
  locale,
  ownerType,
  repoCount,
  t,
}: {
  aggregateStars: string;
  dataAsOf: string | null;
  githubLabel: string;
  githubUrl: string;
  locale: Locale;
  ownerType: string;
  repoCount: number;
  t: Dict;
}) {
  return (
    <dl className="grid gap-3 rounded-lg bg-surface-container px-4 py-4">
      <HeroStat label={t.org.aggregateTrackedStars} value={<>{aggregateStars}<Star /></>} note={t.org.aggregateFootnote} emphasis />
      <HeroStat label={t.tables.trackedRepositories} value={formatInteger(locale, repoCount)} />
      <HeroStat label={t.tables.ownerType} value={ownerType} />
      <HeroStat label={t.common.dataAsOf} value={dataAsOf ?? t.common.notAvailable} />
      <HeroStat
        label={t.repo.githubUrl}
        value={
          <a href={githubUrl} rel="noreferrer" className="break-all text-readable-gold hover:underline hover:underline-offset-2">
            {githubLabel}
          </a>
        }
      />
    </dl>
  );
}

function HeroStat({ label, value, note, emphasis = false }: { label: string; value: ReactNode; note?: string; emphasis?: boolean }) {
  return (
    <div>
      <dt className="font-mono text-[0.68rem] uppercase tracking-wider text-on-surface-variant">{label}</dt>
      <dd className={`mt-1 font-mono tabular-nums ${emphasis ? "text-readable-gold text-[1.45rem] font-extrabold" : "text-[0.92rem] font-semibold text-on-surface"}`}>
        {value}
      </dd>
      {note && <dd className="mt-1 text-[0.78rem] leading-snug text-on-surface-variant">{note}</dd>}
    </div>
  );
}

function MobileTrackedRepositoryCards({
  rows,
  labels,
  locale,
}: {
  rows: Row[];
  labels: ReturnType<typeof repositoryTableLabels>;
  locale: Locale;
}) {
  return (
    <ol className="mt-[clamp(1rem,2vw,1.5rem)] grid gap-3 md:hidden" aria-label={labels.caption}>
      {rows.map((row, index) => (
        <li key={`${row.owner}/${row.name}`}>
          <Link
            href={localizedPath(locale, `/${row.owner}/${row.name}`)}
            className="block rounded-lg bg-surface-container px-4 py-3 transition-colors hover:bg-surface-container-high"
          >
            <span className="flex items-start justify-between gap-3">
              <span className="text-readable-gold shrink-0 font-mono text-[1.15rem] font-extrabold tabular-nums">#{index + 1}</span>
              <span className="min-w-0 text-right">
                <span className="block font-mono text-[0.68rem] uppercase tracking-wider text-on-surface-variant">{labels.totalStars}</span>
                <span className="block font-mono text-[0.95rem] font-extrabold tabular-nums text-on-surface">
                  {fmtStars(row.total, locale)}
                  <Star />
                </span>
              </span>
            </span>
            <span className="mt-2 block break-all font-mono text-[0.95rem] font-semibold text-on-surface">
              {row.owner}/{row.name}
            </span>
            <span className="mt-1 block font-mono text-[0.75rem] text-on-surface-variant">{row.lang ?? labels.unknown}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function buildOrgTrendSummary(t: Dict, org: OrgEntity, language: string): string | null {
  const first = org.curve.monthly[0];
  const latest = org.curve.monthly.at(-1);
  if (!first || !latest || org.curve.monthly.length < 2) return null;

  return fill(t.org.trendSummary, {
    login: org.login,
    start: formatInteger(language, first[2]),
    startPeriod: first[0],
    end: formatInteger(language, latest[2]),
    endPeriod: latest[0],
    change: signedStars(latest[1], language),
  });
}

function orgOwnerTypeLabel(t: Dict, ownerType: string | null | undefined): string {
  if (ownerType === "Organization") return t.org.organization;
  if (ownerType === "User") return t.org.developer;
  return t.tables.unknown;
}

function signedStars(value: number, locale: string): string {
  const prefix = value >= 0 ? "+" : "-";
  return `${prefix}${fmtStars(Math.abs(value), locale)}`;
}

function relatedItem(href: string, label: string) {
  return { href: href as `/${string}`, label };
}

function EmptyState({ message, className = "" }: { message: string; className?: string }) {
  return (
    <p className={`mt-[clamp(1rem,2vw,1.5rem)] rounded-lg border border-dashed border-outline-variant bg-surface-container px-4 py-4 text-[0.9rem] text-on-surface-variant ${className}`}>
      {message}
    </p>
  );
}

function buildLocalizedOrgCapsule(t: Dict, language: string, org: OrgEntity, asOf: string): AnswerCapsuleContent {
  const kind = org.owner_type === "Organization" ? t.org.organization : t.org.developer;
  const text = fill(t.org.capsule, {
    asOf,
    login: org.login,
    stars: fmtStars(org.current_stars_sum, language),
    repos: org.repo_count.toLocaleString(language),
    kind,
  });
  return { text: withSource(text), asOf, source: ANSWER_CAPSULE_SOURCE };
}

function buildLocalizedOrgFaqs(t: Dict, language: string, org: OrgEntity, members: readonly Row[], asOf: string | null): FaqItem[] {
  const kind = org.owner_type === "Organization" ? t.org.organization : t.org.developer;
  const lead = members[0];
  const leadAnswer = lead
    ? fill(t.org.faqLeadAnswer, { repo: repoName(lead), login: org.login, stars: fmtStars(lead.total, language) })
    : fill(t.org.faqLeadFallback, { login: org.login });

  return [
    {
      question: fill(t.org.faqStarsQuestion, { login: org.login }),
      answer: asOf
        ? fill(t.org.faqStarsAnswerWithAsOf, {
            asOf,
            login: org.login,
            stars: fmtStars(org.current_stars_sum, language),
            repos: org.repo_count.toLocaleString(language),
          })
        : fill(t.org.faqStarsAnswerNoAsOf, {
            login: org.login,
            stars: fmtStars(org.current_stars_sum, language),
            repos: org.repo_count.toLocaleString(language),
          }),
    },
    {
      question: fill(t.org.faqKindQuestion, { login: org.login }),
      answer: fill(t.org.faqKindAnswer, { login: org.login, kind }),
    },
    {
      question: fill(t.org.faqLeadQuestion, { login: org.login }),
      answer: leadAnswer,
    },
    {
      question: t.org.faqCalculationQuestion,
      answer: t.org.faqCalculationAnswer,
    },
  ];
}

function buildLocalizedOrgTotalSnippet({
  t,
  locale,
  org,
  asOf,
  members,
}: {
  t: Dict;
  locale: Locale;
  org: { login: string; current_stars_sum: number; repo_count: number };
  asOf: string | null;
  members: Row[];
}): ShareableSnippetContent | null {
  if (!asOf) return null;

  const language = toBcp47Locale(locale);
  const top = members.slice(0, 3);
  const leaders = top.length
    ? fill(t.org.totalSnippetLeaders, {
        repos: listLabels(
          language,
          top.map((row) => fill(t.org.totalSnippetLeader, { repo: repoName(row), stars: fmtStars(row.total, language) })),
        ),
      })
    : "";
  const text = fill(t.org.totalSnippetText, {
    asOf,
    login: org.login,
    stars: fmtStars(org.current_stars_sum, language),
    repos: org.repo_count.toLocaleString(language),
    leaders,
  });

  return snippet({
    kind: "org-total",
    title: fill(t.org.totalSnippetTitle, { login: org.login }),
    text,
    links: [
      { label: fill(t.org.starHistoryLink, { login: org.login }), href: localizedPath(locale, `/o/${org.login}`) },
      ...top.map((row) => ({ label: repoName(row), href: localizedPath(locale, `/${repoName(row)}`) })),
    ],
    sourceLabel: t.common.source,
  });
}

function snippet({
  kind,
  title,
  text,
  links,
  sourceLabel,
}: {
  kind: ShareableSnippetContent["kind"];
  title: string;
  text: string;
  links: Array<{ label: string; href: string }>;
  sourceLabel: string;
}): ShareableSnippetContent {
  const canonicalLinks = links.map((link) => ({ ...link, href: absoluteSnippetUrl(link.href) }));
  const copyText = [text, ...canonicalLinks.map((link) => `${link.label}: ${link.href}`)].join("\n");
  return {
    kind,
    title,
    text,
    links: canonicalLinks,
    copyText,
    embedHtml: embedHtml(title, text, canonicalLinks, sourceLabel),
  };
}

function embedHtml(title: string, text: string, links: Array<{ label: string; href: string }>, sourceLabel: string): string {
  const source = links[0];
  return [
    `<blockquote cite="${escapeAttribute(source?.href ?? absoluteSnippetUrl("/"))}">`,
    `<p><strong>${escapeHtml(title)}</strong></p>`,
    `<p>${escapeHtml(text)}</p>`,
    source ? `<p><a href="${escapeAttribute(source.href)}">${escapeHtml(sourceLabel)}: ${escapeHtml(source.label)}</a></p>` : "",
    `</blockquote>`,
  ]
    .filter(Boolean)
    .join("");
}

function repoName(row: { owner: string; name: string }): string {
  return `${row.owner}/${row.name}`;
}

function listLabels(language: string, values: readonly string[]): string {
  if (values.length === 0) return "";
  return new Intl.ListFormat(language, { type: "conjunction" }).format([...values]);
}

function withSource(text: string): string {
  return `${text} - ${ANSWER_CAPSULE_SOURCE}`;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
