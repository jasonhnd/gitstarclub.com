import Link from "next/link";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Chrome } from "@/app/_explore/Chrome";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { FaqBlock } from "@/app/_explore/FaqBlock";
import { JsonLd } from "@/app/_explore/JsonLd";
import { StarCurve } from "@/app/_explore/StarCurve";
import { ShareButton } from "@/app/_explore/ShareButton";
import { ShareableSnippet } from "@/app/_explore/ShareableSnippet";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { DAILY_BASE_VIEW_TTL_MS, getRepoIdByFullNameDaily, getRepoEntityDaily, getAliasMapDaily, getReposLookupDaily, getCategoryAssignments, getCategoryRegistry, getMeta } from "@/lib/data";
import type { RepoEntity } from "@/lib/contracts";
import { fmtStars, ymParts, monthLabel, monthYearLabel } from "@/lib/format";
import { pageMeta } from "@/lib/seo";
import { repoLd, type FaqItem } from "@/lib/jsonld";
import { exactRepoMilestones, type ExactRepoMilestone } from "@/lib/repo-milestones";
import { resolveRepoRoute } from "@/lib/repo-route";
import { ANSWER_CAPSULE_SOURCE, resolveDataAsOfFromMeta, type AnswerCapsuleContent } from "@/lib/geo-capsules";
import { absoluteSnippetUrl, type ShareableSnippetContent } from "@/lib/shareable-snippets";
import { getDictionary, type Dict, type Locale } from "@/lib/i18n";
import { localizedPath, toBcp47Locale } from "@/lib/i18n/routing";
import { languageHref, relatedRepositories, repoCategoryLinks, repoLanguageEntries, type RelatedRepo, type RepoCategoryLink, type RepoLanguage } from "@/lib/repo-page";


// Resolve a URL slug → repo id. On a miss, if the slug is a former name of a still-tracked repo
// (GitHub rename, e.g. facebook/react → react/react), 308-redirect to its current slug; otherwise
// return undefined so the caller can 404.
async function resolveRepoId(fullName: string, locale: Locale): Promise<number | undefined> {
  const idsByFullName = await getRepoIdByFullNameDaily();
  const direct = resolveRepoRoute(fullName, idsByFullName, null, null);
  if (direct.kind === "found") return direct.id;

  const resolution = resolveRepoRoute(fullName, idsByFullName, await getAliasMapDaily(), await getReposLookupDaily());
  if (resolution.kind === "found") return resolution.id;
  if (resolution.kind === "redirect") permanentRedirect(localizedPath(locale, resolution.location));
  return undefined;
}

export async function generateRepoMetadata({ locale, owner, name }: { locale: Locale; owner: string; name: string }): Promise<Metadata> {
  const t = await getDictionary(locale);
  const language = toBcp47Locale(locale);
  const fullName = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
  const id = await resolveRepoId(fullName, locale);
  const repo = id !== undefined ? await getRepoEntityDaily(id) : null;
  if (!repo) {
    return pageMeta({
      title: `${fullName} — ${t.repo.starHistory}`,
      description: fill(t.repo.metaFallbackDescription, { repo: fullName }),
      path: `/${fullName}`,
      locale,
    });
  }
  return pageMeta({
    title: `${repo.full_name} — ${t.repo.metaTitleSuffix}`,
    description: fill(t.repo.metaDescription, {
      repo: repo.full_name,
      stars: repo.current_stars.toLocaleString(language),
    }),
    path: `/${repo.full_name}`,
    locale,
    ogImage: `/${repo.full_name}/opengraph-image`,
  });
}

export async function RepoPageView({ locale, owner, name }: { locale: Locale; owner: string; name: string }) {
  const t = await getDictionary(locale);
  const language = toBcp47Locale(locale);
  const href = (path: string) => localizedPath(locale, path);
  const fullName = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
  const id = await resolveRepoId(fullName, locale);
  if (id === undefined) notFound();
  const [repo, lookup, assignments, registry, meta] = await Promise.all([
    getRepoEntityDaily(id),
    getReposLookupDaily(),
    getCategoryAssignments(),
    getCategoryRegistry(),
    getMeta(DAILY_BASE_VIEW_TTL_MS),
  ]);
  if (!repo) notFound();

  const series = repo.curve.monthly.map(([period, , totalEnd]) => ({ label: period, total: totalEnd }));
  const milestones = exactRepoMilestones(series, repo.milestones);
  const inflections = (repo.inflections ?? []).flatMap((inf) => {
    const monthIndex = series.findIndex((p) => p.label === inf.period);
    return monthIndex >= 0 ? [{ monthIndex, flow: inf.flow, kind: inf.kind, label: inf.period }] : [];
  });
  const languages = repoLanguageEntries(repo);
  const languageTotalSize = repo.languages?.reduce((sum, language) => sum + Math.max(0, language.size ?? 0), 0) ?? 0;
  const monthly = [...repo.monthly_table].reverse();
  const created = ymParts(repo.created_at);
  const categoryLinks = repoCategoryLinks(id, assignments, registry, languages);
  const related = relatedRepositories(repo, lookup);
  const asOf = resolveDataAsOfFromMeta(meta, repo.curve.recent_daily.at(-1)?.[0], repo.curve.monthly.at(-1)?.[0], { locale });
  const capsule = asOf ? buildLocalizedRepoCapsule(t, locale, repo, asOf) : null;
  const milestoneSnippet = buildLocalizedRepoMilestoneSnippet({ t, locale, repo, asOf, milestones });
  const faqItems = buildLocalizedRepoFaqs(t, locale, repo, asOf);
  const pagePath = `/${repo.full_name}`;
  const routePath = localizedPath(locale, pagePath);
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
      <JsonLd data={repoLd(repo, routePath, language)} />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[72rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs
          locale={locale}
          dictionary={t}
          items={[
            { path: "nav.home", href: "/" },
            { label: repo.owner, href: `/o/${repo.owner}` },
            { label: repo.name },
          ]}
        />

        <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <header className="animate-rise">
            <h1 className="flex flex-wrap items-baseline gap-x-1 gap-y-1 font-mono text-[clamp(1.4rem,4vw,2.2rem)]">
              <span className="text-on-surface-variant">{repo.owner} /</span>
              <span className="font-semibold text-on-surface">{repo.name}</span>
            </h1>
            {repo.description && (
              <p className="mt-3 max-w-[52ch] text-[clamp(1rem,1.7vw,1.2rem)] text-on-surface-variant">{repo.description}</p>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[0.8rem] text-on-surface-variant">
              <span className="text-readable-gold text-[1.6rem] font-extrabold tabular-nums">
                {fmtStars(repo.current_stars)}
                <span className="text-[0.9rem] text-on-surface-variant"> ★</span>
              </span>
              {languages[0] && (
                <Link href={href(languageHref(languages[0].name))} className="text-tertiary hover:text-primary hover:underline hover:underline-offset-[3px]">
                  {languages[0].name}
                </Link>
              )}
              <span>
                {t.repo.created} {monthLabel(locale, created.m, "short")} {created.y}
              </span>
              {repo.is_archived && (
                <span className="text-tertiary">
                  {t.repo.archived}
                </span>
              )}
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

          <aside className="rounded-2xl bg-surface-container px-4 py-4">
            <h2 className="font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">
              {t.repo.about}
            </h2>
            {repo.description && <p className="mt-3 text-[0.95rem] leading-relaxed text-on-surface">{repo.description}</p>}
            <dl className="mt-4 grid gap-3 text-[0.86rem]">
              <MetaRow label={t.repo.owner} value={repo.owner} href={href(`/o/${repo.owner}`)} />
              {languages.length > 0 && (
                <MetaRow label={languages.length > 1 ? t.repo.languages : t.repo.language} value={<LanguageLinks languages={languages} totalSize={languageTotalSize} locale={locale} />} wrap />
              )}
              {repo.license && <MetaRow label={t.repo.license} value={repo.license} />}
              {repo.homepage_url && <MetaRow label={t.repo.homepage} value={repo.homepage_url.replace(/^https?:\/\//, "")} href={repo.homepage_url} external />}
              <MetaRow
                label={t.repo.latestRelease}
                value={repo.latest_release ? repo.latest_release.name || repo.latest_release.tag_name : t.repo.noRelease}
                href={repo.latest_release?.url ?? undefined}
                external={Boolean(repo.latest_release?.url)}
              />
            </dl>
            {repo.topics.length > 0 && (
              <div className="mt-5">
                <h3 className="font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">
                  {t.repo.topics}
                </h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {repo.topics.slice(0, 12).map((tp) => (
                    <span key={tp} className="rounded-full bg-surface-container-high px-2.5 py-1 font-mono text-[0.72rem] text-on-surface-variant">
                      {tp}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <a href={`https://github.com/${repo.full_name}`} rel="noreferrer" className="mt-5 inline-flex items-center gap-1 font-semibold text-tertiary transition-colors hover:text-primary hover:underline hover:underline-offset-[3px]">
              {t.repo.github} →
            </a>
          </aside>
        </div>

        {capsule && <AnswerCapsule capsule={capsule} labels={capsuleLabels} className="mt-[clamp(1.75rem,3.5vw,2.5rem)]" />}

        <RepoLinkHub owner={repo.owner} categories={categoryLinks} related={related} locale={locale} t={t} />

        <div className="max-w-[60rem]">
          {series.length > 1 && (
            <section className="mt-[clamp(2rem,4vw,3rem)]">
              <h2 className="mb-3 font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">
                {t.repo.history}
              </h2>
              <StarCurve series={series} milestones={milestones} inflections={inflections} labels={{ ariaLabel: t.a11y.starHistory }} />
            </section>
          )}

          {milestones.length > 0 && (
            <section className="mt-[clamp(2rem,4vw,3rem)]">
              <h2 className="mb-3 text-[1.2rem] font-extrabold tracking-tight text-on-surface">
                {t.repo.milestones}
              </h2>
              <ul className="flex flex-wrap gap-2">
                {milestones.map((m) => {
                  const d = ymParts(m.date);
                  return (
                    <li key={m.stars}>
                      <Link href={href(`/rankings/${d.y}/${d.m}`)} className="inline-flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-4 py-2 transition-colors hover:bg-surface-container-high">
                        <span className="text-readable-gold font-extrabold">{m.label}</span>
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
          )}

          {monthly.length > 0 && (
            <section className="mt-[clamp(2rem,4vw,3rem)]">
              <h2 className="mb-3 text-[1.2rem] font-extrabold tracking-tight text-on-surface">
                {t.repo.recent}
              </h2>
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
                          {row.rank != null ? (
                            <>
                              {t.repo.rank} #{row.rank}
                            </>
                          ) : (
                            ""
                          )}
                        </span>
                        <span className="font-semibold tabular-nums text-on-surface sm:w-20 sm:text-right">+{fmtStars(row.adds)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
      </main>
    </>
  );
}

function RepoLinkHub({
  owner,
  categories,
  related,
  locale,
  t,
}: {
  owner: string;
  categories: RepoCategoryLink[];
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
                <Link
                  key={entry.full_name}
                  href={href(`/${entry.full_name}`)}
                  className="min-w-0 rounded-lg bg-surface-container-high px-3 py-2 transition-colors hover:bg-surface-container-highest"
                >
                  <span className="block truncate font-mono text-[0.78rem] font-semibold text-on-surface" title={entry.full_name}>
                    {entry.owner}/{entry.name}
                  </span>
                  <span className="mt-1 block font-mono text-[0.68rem] text-on-surface-variant">
                    {fmtStars(entry.current_stars)}★{entry.language ? ` · ${entry.language}` : ""}
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
  const valueNode = href ? (
    <a href={href} className="truncate font-semibold text-tertiary hover:text-primary hover:underline hover:underline-offset-[3px]" {...(external ? { rel: "noreferrer" } : {})}>
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

function buildLocalizedRepoCapsule(t: Dict, locale: Locale, repo: RepoEntity, asOf: string): AnswerCapsuleContent {
  const latest = repo.monthly_table.at(-1);
  const language = repo.language ? `${repo.language} ` : "";
  const latestPhrase = latest
    ? fill(t.repo.capsuleLatest, {
        month: monthYearFromPeriod(locale, latest.month),
        stars: signedStars(latest.adds),
      })
    : t.repo.capsuleLatestFallback;
  const text = fill(t.repo.capsule, {
    asOf,
    repo: repo.full_name,
    stars: fmtStars(repo.current_stars),
    language,
    milestones: repoMilestonePhrase(t, locale, repo),
    latest: latestPhrase,
  });
  return { text: withSource(text), asOf, source: ANSWER_CAPSULE_SOURCE };
}

function buildLocalizedRepoFaqs(t: Dict, locale: Locale, repo: RepoEntity, asOf: string | null): FaqItem[] {
  const latest = repo.curve.monthly.at(-1);
  const latestPhrase = latest
    ? fill(t.repo.latestMonthlyPoint, {
        month: monthYearFromPeriod(locale, latest[0]),
        stars: signedStars(latest[1]),
        total: fmtStars(latest[2]),
      })
    : t.repo.monthlyUnavailable;
  const language = repo.language ?? t.repo.unspecifiedLanguage;

  return [
    {
      question: fill(t.repo.faqStarsQuestion, { repo: repo.full_name }),
      answer: asOf
        ? fill(t.repo.faqStarsAnswerWithAsOf, { asOf, repo: repo.full_name, stars: fmtStars(repo.current_stars) })
        : fill(t.repo.faqStarsAnswerNoAsOf, { repo: repo.full_name, stars: fmtStars(repo.current_stars) }),
    },
    {
      question: fill(t.repo.faqLanguageQuestion, { repo: repo.full_name }),
      answer: fill(t.repo.faqLanguageAnswer, { repo: repo.full_name, language, owner: repo.owner }),
    },
    {
      question: fill(t.repo.faqMilestonesQuestion, { repo: repo.full_name }),
      answer: repoMilestoneAnswer(t, locale, repo),
    },
    {
      question: fill(t.repo.faqLatestQuestion, { repo: repo.full_name }),
      answer: fill(t.repo.faqLatestAnswer, { repo: repo.full_name, latest: latestPhrase }),
    },
    {
      question: t.repo.faqNoLiveQuestion,
      answer: t.repo.faqNoLiveAnswer,
    },
  ];
}

function buildLocalizedRepoMilestoneSnippet({
  t,
  locale,
  repo,
  asOf,
  milestones,
}: {
  t: Dict;
  locale: Locale;
  repo: { full_name: string };
  asOf: string | null;
  milestones: ExactRepoMilestone[];
}): ShareableSnippetContent | null {
  if (!asOf || milestones.length === 0) return null;

  const milestoneText = listLabels(
    locale,
    milestones.map((milestone) =>
      fill(t.repo.milestoneIn, {
        milestone: milestone.label,
        month: monthYearFromPeriod(locale, milestone.date),
      }),
    ),
  );
  return snippet({
    kind: "repo-milestones",
    title: fill(t.repo.milestoneSnippetTitle, { repo: repo.full_name }),
    text: fill(t.repo.milestoneSnippetText, { asOf, repo: repo.full_name, milestones: milestoneText }),
    links: [
      { label: fill(t.repo.starHistoryLink, { repo: repo.full_name }), href: localizedPath(locale, `/${repo.full_name}`) },
      ...milestones.map((milestone) => {
        const [year, month] = milestone.date.slice(0, 7).split("-");
        return {
          label: fill(t.repo.milestoneRankingMonth, { milestone: milestone.label }),
          href: localizedPath(locale, `/rankings/${year}/${Number(month)}`),
        };
      }),
    ],
    sourceLabel: t.common.source,
  });
}

function repoMilestonePhrase(t: Dict, locale: Locale, repo: RepoEntity): string {
  const known = repoMilestoneLabels(t, locale, repo);
  return known.length > 0 ? listLabels(locale, known) : t.repo.milestoneFallback;
}

function repoMilestoneAnswer(t: Dict, locale: Locale, repo: RepoEntity): string {
  const known = repoMilestoneLabels(t, locale, repo);
  if (known.length === 0) return fill(t.repo.faqMilestonesAnswerNone, { repo: repo.full_name });
  return fill(t.repo.faqMilestonesAnswerSome, { repo: repo.full_name, milestones: listLabels(locale, known) });
}

function repoMilestoneLabels(t: Dict, locale: Locale, repo: RepoEntity): string[] {
  const milestones = [
    ["10k", repo.milestones.crossed_10k],
    ["50k", repo.milestones.crossed_50k],
    ["100k", repo.milestones.crossed_100k],
  ] as const;
  return milestones.flatMap(([milestone, date]) =>
    date
      ? [
          fill(t.repo.milestoneIn, {
            milestone,
            month: monthYearFromPeriod(locale, date),
          }),
        ]
      : [],
  );
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

function monthYearFromPeriod(locale: Locale, period: string): string {
  const { y, m } = ymParts(period);
  return monthYearLabel(locale, y, m);
}

function signedStars(value: number): string {
  const prefix = value >= 0 ? "+" : "-";
  return `${prefix}${fmtStars(Math.abs(value))}`;
}

function listLabels(locale: Locale, values: readonly string[]): string {
  if (values.length === 0) return "";
  return new Intl.ListFormat(toBcp47Locale(locale), { type: "conjunction" }).format([...values]);
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
