import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import type { ReactNode } from "react";
import { Chrome } from "@/app/_explore/Chrome";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { FaqBlock } from "@/app/_explore/FaqBlock";
import { JsonLd } from "@/app/_explore/JsonLd";
import { PageHero } from "@/app/_explore/PageHero";
import { RelatedPages, type RelatedPageItem } from "@/app/_explore/RelatedPages";
import { ShareButton } from "@/app/_explore/ShareButton";
import { Star } from "@/app/_explore/Star";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { DAILY_BASE_VIEW_TTL_MS, getRepoIdByFullNameDaily, getRepoPageEntityDaily, getAliasMapDaily, getReposLookupDaily, getCategoryAssignments, getCategoryRegistry, getMeta } from "@/lib/data";
import { fmtStars, ymParts, monthYearLabel } from "@/lib/format";
import { pageMeta } from "@/lib/seo";
import { repoLd, type FaqItem } from "@/lib/jsonld";
import { exactRepoMilestones, type ExactRepoMilestone } from "@/lib/repo-milestones";
import { resolveRepoRoute } from "@/lib/repo-route";
import type { RepoPageEntity } from "@/lib/repo-readiness";
import { ANSWER_CAPSULE_SOURCE, resolveDataAsOfFromMeta, type AnswerCapsuleContent } from "@/lib/geo-capsules";
import { absoluteSnippetUrl, type ShareableSnippetContent } from "@/lib/shareable-snippets";
import { getDictionary, type Dict, type Locale } from "@/lib/i18n";
import { localizedPath, toBcp47Locale } from "@/lib/i18n/routing";
import { safeExternalHref } from "@/lib/external-url";
import {
  buildRepoHub,
  languageHref,
  ownerHref,
  rankingMonthHref,
  rankingMonthHrefIfRoutable,
  repoLanguageEntries,
  type CategoryLink,
  type RelatedRepo,
  type RepoHubRankingAppearance,
  type RepoLanguage,
} from "@/lib/repo-page";
import { RepoHistorySection, RepoMilestonesSection } from "./repo-sections";

const HERO_ACTION_CLASS =
  "text-readable-gold rounded-full border border-outline-variant bg-surface-container px-3 py-2 font-mono text-[0.78rem] transition-colors hover:bg-surface-container-high hover:underline";
const FACT_LINK_CLASS = "font-semibold text-tertiary hover:text-primary hover:underline hover:underline-offset-[3px]";
const CHIP_CLASS =
  "inline-flex max-w-full items-center gap-2 rounded-full bg-surface-container-high px-2.5 py-1 font-mono text-[0.72rem] text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary";

type RepoLanguageFact = RepoLanguage & { href?: string | null };

// Resolve a URL slug → repo id. Search results, bookmarks, and external links can still carry a
// former name after a GitHub rename (for example facebook/react → react/react), so a tracked alias
// receives a 308 to its current canonical slug. Unknown names still fall through to the localized 404.
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
  const repo = id !== undefined ? await getRepoPageEntityDaily(id) : null;
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
  const fullName = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
  const id = await resolveRepoId(fullName, locale);
  if (id === undefined) notFound();
  const [repo, lookup, assignments, registry, meta] = await Promise.all([
    getRepoPageEntityDaily(id),
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
  const factLanguages: RepoLanguageFact[] =
    languages.length > 0 ? languages.map((language) => ({ ...language, href: languageHref(language.name) })) : repo.language ? [{ name: repo.language, size: null, color: null, href: null }] : [];
  const primaryLanguage = languages[0]?.name ?? repo.language;
  const languageTotalSize = repo.languages.reduce((sum, language) => sum + Math.max(0, language.size ?? 0), 0);
  const created = repo.created_at ? ymParts(repo.created_at) : null;
  const hub = buildRepoHub({
    repoId: id,
    owner: repo.owner,
    fullName: repo.full_name,
    language: repo.language,
    languages,
    rankHistory: repo.rank_history,
    monthlyTable: repo.monthly_table,
    assignments,
    registry,
    lookup,
  });
  const categoryLinks = hub.categories;
  const related = hub.related;
  const rankingAppearances = hub.rankingAppearances;
  const asOf = resolveDataAsOfFromMeta(meta, repo.curve.recent_daily.at(-1)?.[0], repo.curve.monthly.at(-1)?.[0], { locale });
  const capsule = asOf ? buildLocalizedRepoCapsule(t, locale, repo, asOf) : null;
  const milestoneSnippet = buildLocalizedRepoMilestoneSnippet({ t, locale, repo, asOf, milestones });
  const faqItems = buildLocalizedRepoFaqs(t, locale, repo, asOf);
  const pagePath = `/${repo.full_name}`;
  const routePath = localizedPath(locale, pagePath);
  const href = (path: string) => localizedPath(locale, path);
  const homepageHref = safeExternalHref(repo.homepage_url);
  const releaseHref = safeExternalHref(repo.latest_release?.url);
  const githubHref = `https://github.com/${repo.full_name}`;
  const relatedItems = buildRepoRelatedItems({ locale, owner: repo.owner, categories: categoryLinks, related, rankingAppearances });
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

        <PageHero
          className="mt-5"
          eyebrow={t.repo.profileEyebrow}
          title={
            <span className="block min-w-0 break-words [overflow-wrap:anywhere]">
              <span className="text-on-surface-variant">{repo.owner}/</span>
              {repo.name}
            </span>
          }
          lede={repo.description || t.repo.noDescription}
          actions={
            <RepoHeroActions
              compareHref={href(hub.compare.href)}
              ownerHref={href(hub.owner.href)}
              owner={repo.owner}
              githubHref={githubHref}
              homepageHref={homepageHref}
              repo={repo}
              t={t}
            />
          }
          aside={
            <RepoHeroFacts
              createdLabel={created ? monthYearLabel(locale, created.y, created.m) : t.repo.noCreatedAtMetadata}
              license={repo.license}
              locale={locale}
              primaryLanguage={primaryLanguage}
              primaryLanguageHref={languages[0] ? href(languageHref(languages[0].name)) : null}
              repo={repo}
              t={t}
            />
          }
        />

        <EntityFactPanel
          categories={categoryLinks}
          githubHref={githubHref}
          homepageHref={homepageHref}
          languageTotalSize={languageTotalSize}
          languages={factLanguages}
          locale={locale}
          ownerHref={href(hub.owner.href)}
          releaseHref={releaseHref}
          repo={repo}
          t={t}
        />

        {capsule && <AnswerCapsule capsule={capsule} labels={capsuleLabels} className="mt-[clamp(1.75rem,3.5vw,2.5rem)]" />}

        <div className="min-w-0 max-w-full">
          <RepoHistorySection inflections={inflections} milestones={milestones} series={series} locale={locale} t={t} />
          <RepoMilestonesSection locale={locale} milestoneSnippet={milestoneSnippet} milestones={milestones} snippetLabels={snippetLabels} t={t} />
          <RankingAppearancesSection appearances={rankingAppearances} locale={locale} t={t} />
          <RelatedRepositoriesSection
            explanation={relatedRepositoriesExplanation(t, hub.relatedSource, repo.language)}
            locale={locale}
            related={related}
            t={t}
          />
        </div>

        <RelatedPages title={t.repo.relatedPages} description={t.repo.relatedDescription} items={relatedItems} />

        <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
      </main>
    </>
  );
}

function RepoHeroActions({
  compareHref,
  ownerHref,
  owner,
  githubHref,
  homepageHref,
  repo,
  t,
}: {
  compareHref: string;
  ownerHref: string;
  owner: string;
  githubHref: string;
  homepageHref: string | null;
  repo: RepoPageEntity;
  t: Dict;
}) {
  return (
    <>
      <Link href={compareHref} className={HERO_ACTION_CLASS}>
        {t.compare.addToCompare}
      </Link>
      <Link href={ownerHref} className={HERO_ACTION_CLASS}>
        /o/{owner}
      </Link>
      <a href={githubHref} rel="noreferrer" className={HERO_ACTION_CLASS}>
        {t.repo.github}
      </a>
      {homepageHref && (
        <a href={homepageHref} rel="noreferrer" className={HERO_ACTION_CLASS}>
          {t.repo.homepage}
        </a>
      )}
      <ShareButton text={`${repo.full_name} - ${t.repo.starHistory}`} labels={t.share} />
    </>
  );
}

function RepoHeroFacts({
  createdLabel,
  license,
  locale,
  primaryLanguage,
  primaryLanguageHref,
  repo,
  t,
}: {
  createdLabel: string;
  license: string | null | undefined;
  locale: Locale;
  primaryLanguage: string | null | undefined;
  primaryLanguageHref: string | null;
  repo: RepoPageEntity;
  t: Dict;
}) {
  return (
    <dl className="grid gap-3 rounded-2xl border border-outline-variant bg-surface-container px-4 py-4">
      <HeroFact label={t.repo.currentStars}>
        <span className="text-readable-gold text-[1.15rem] font-extrabold tabular-nums">
          {fmtStars(repo.current_stars, locale)}
          {" "}
          <Star />
        </span>
      </HeroFact>
      <HeroFact label={t.repo.primaryLanguage}>
        {primaryLanguage ? (
          primaryLanguageHref ? (
            <Link href={primaryLanguageHref} className={FACT_LINK_CLASS}>
              {primaryLanguage}
            </Link>
          ) : (
            primaryLanguage
          )
        ) : (
          t.repo.unspecifiedLanguage
        )}
      </HeroFact>
      <HeroFact label={t.repo.created}>{createdLabel}</HeroFact>
      <HeroFact label={t.repo.tracking}>
        {repo.active !== false ? t.repo.trackingActive : t.repo.trackingHistorical}
      </HeroFact>
      {repo.tracked_since && <HeroFact label={t.repo.trackedSince}>{repo.tracked_since}</HeroFact>}
      <HeroFact label={t.repo.license}>{license || t.repo.noLicenseMetadata}</HeroFact>
      {repo.is_archived && <HeroFact label={t.common.status}>{t.repo.archived}</HeroFact>}
    </dl>
  );
}

function HeroFact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[0.68rem] uppercase tracking-wider text-on-surface-variant">{label}</dt>
      <dd className="mt-1 break-words font-mono text-[0.95rem] font-extrabold text-on-surface">{children}</dd>
    </div>
  );
}

function EntityFactPanel({
  categories,
  githubHref,
  homepageHref,
  languageTotalSize,
  languages,
  locale,
  ownerHref,
  releaseHref,
  repo,
  t,
}: {
  categories: CategoryLink[];
  githubHref: string;
  homepageHref: string | null;
  languageTotalSize: number;
  languages: RepoLanguageFact[];
  locale: Locale;
  ownerHref: string;
  releaseHref: string | null;
  repo: RepoPageEntity;
  t: Dict;
}) {
  const releaseLabel = repo.latest_release ? repo.latest_release.name || repo.latest_release.tag_name : t.repo.noRelease;
  return (
    <section aria-labelledby="repo-facts" className="mt-[clamp(1.75rem,3.5vw,2.5rem)] rounded-2xl border border-outline-variant bg-surface-container/70 px-4 py-4">
      <h2 id="repo-facts" className="font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">
        {t.repo.facts}
      </h2>
      <dl className="mt-4 grid gap-x-6 gap-y-5 md:grid-cols-2">
        <FactRow label={t.repo.owner}>
          <Link href={ownerHref} className={FACT_LINK_CLASS}>
            {repo.owner}
          </Link>
        </FactRow>
        <FactRow label={languages.length > 1 ? t.repo.languages : t.repo.language}>
          <LanguageLinks languages={languages} totalSize={languageTotalSize} locale={locale} t={t} />
        </FactRow>
        <FactRow label={t.repo.topics}>
          <TopicTags topics={repo.topics} t={t} />
        </FactRow>
        <FactRow label={t.repo.license}>{repo.license || <EmptyFact>{t.repo.noLicenseMetadata}</EmptyFact>}</FactRow>
        <FactRow label={t.repo.latestRelease}>
          {repo.latest_release ? (
            releaseHref ? (
              <a href={releaseHref} rel="noreferrer" className={FACT_LINK_CLASS}>
                {releaseLabel}
              </a>
            ) : (
              releaseLabel
            )
          ) : (
            <EmptyFact>{t.repo.noRelease}</EmptyFact>
          )}
        </FactRow>
        <FactRow label={t.repo.homepage}>
          {homepageHref ? (
            <a href={homepageHref} rel="noreferrer" className={`${FACT_LINK_CLASS} break-all`}>
              {displayUrl(homepageHref)}
            </a>
          ) : (
            <EmptyFact>{t.repo.noHomepageMetadata}</EmptyFact>
          )}
        </FactRow>
        <FactRow label={t.repo.githubUrl}>
          <a href={githubHref} rel="noreferrer" className={`${FACT_LINK_CLASS} break-all`}>
            {displayUrl(githubHref)}
          </a>
        </FactRow>
        <FactRow label={t.repo.categoryTags}>
          <CategoryChips categories={categories} locale={locale} t={t} />
        </FactRow>
      </dl>
    </section>
  );
}

function FactRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">{label}</dt>
      <dd className="mt-2 min-w-0 text-[0.9rem] leading-relaxed text-on-surface">{children}</dd>
    </div>
  );
}

function LanguageLinks({ languages, totalSize, locale, t }: { languages: RepoLanguageFact[]; totalSize: number; locale: Locale; t: Dict }) {
  if (languages.length === 0) return <EmptyFact>{t.repo.noLanguages}</EmptyFact>;
  const total = totalSize || languages.reduce((sum, language) => sum + Math.max(0, language.size ?? 0), 0);
  return (
    <div className="flex flex-wrap gap-2">
      {languages.map((language) => {
        const share = total > 0 && language.size ? Math.round((language.size / total) * 1000) / 10 : null;
        const content = (
          <>
            {language.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: language.color }} aria-hidden="true" />}
            <span className="truncate">{language.name}</span>
            {share !== null && <span className="shrink-0 text-on-surface-variant">{share}%</span>}
          </>
        );
        return language.href ? (
          <Link key={language.name} href={localizedPath(locale, language.href)} className={CHIP_CLASS}>
            {content}
          </Link>
        ) : (
          <span key={language.name} className="inline-flex max-w-full items-center gap-2 rounded-full bg-surface-container-high px-2.5 py-1 font-mono text-[0.72rem] text-on-surface-variant">
            {content}
          </span>
        );
      })}
    </div>
  );
}

function TopicTags({ topics, t }: { topics: string[]; t: Dict }) {
  if (topics.length === 0) return <EmptyFact>{t.repo.noTopics}</EmptyFact>;
  return (
    <div className="flex flex-wrap gap-2">
      {topics.slice(0, 12).map((topic) => (
        <span key={topic} className="rounded-full bg-surface-container-high px-2.5 py-1 font-mono text-[0.72rem] text-on-surface-variant">
          {topic}
        </span>
      ))}
    </div>
  );
}

function CategoryChips({ categories, locale, t }: { categories: CategoryLink[]; locale: Locale; t: Dict }) {
  if (categories.length === 0) return <EmptyFact>{t.repo.noCategories}</EmptyFact>;
  return (
    <div className="flex flex-wrap gap-2">
      {categories.map((category) => (
        <Link key={category.id} href={localizedPath(locale, category.href)} className={CHIP_CLASS}>
          <span className="truncate">{category.label}</span>
        </Link>
      ))}
    </div>
  );
}

function RankingAppearancesSection({ appearances, locale, t }: { appearances: RepoHubRankingAppearance[]; locale: Locale; t: Dict }) {
  return (
    <section className="mt-[clamp(2rem,4vw,3rem)] min-w-0">
      <div className="max-w-[64ch]">
        <h2 className="text-[1.2rem] font-extrabold tracking-tight text-on-surface">{t.repo.rankingAppearances}</h2>
        <p className="mt-2 text-[0.9rem] leading-relaxed text-on-surface-variant">{t.repo.rankingDescription}</p>
      </div>
      {appearances.length > 0 ? (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {appearances.map((entry) => {
            return (
              <li key={entry.period}>
                <Link href={localizedPath(locale, rankingMonthHref(entry.period))} className="group flex h-full min-h-16 items-center justify-between gap-3 rounded-lg bg-surface-container px-4 py-3 transition-colors hover:bg-surface-container-high">
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[0.9rem] font-semibold text-on-surface group-hover:underline group-hover:underline-offset-2">{monthYearFromPeriod(locale, entry.period)}</span>
                    <span className="mt-1 block font-mono text-[0.74rem] text-on-surface-variant">
                      {t.repo.rank} #{entry.rank}
                      {typeof entry.adds === "number" ? (
                        <>
                          {" · +"}
                          {fmtStars(entry.adds, locale)}
                          <Star />
                        </>
                      ) : (
                        ""
                      )}
                    </span>
                  </span>
                  <span aria-hidden className="shrink-0 font-mono text-[1rem] text-on-surface-variant transition-colors group-hover:text-on-surface">
                    &rarr;
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState message={t.repo.noRankingAppearances} />
      )}
    </section>
  );
}

function EmptyFact({ children }: { children: ReactNode }) {
  return <span className="text-on-surface-variant">{children}</span>;
}

function EmptyState({ message }: { message: string }) {
  return <p className="mt-4 rounded-lg border border-dashed border-outline-variant bg-surface-container px-4 py-4 text-[0.9rem] text-on-surface-variant">{message}</p>;
}

function RelatedRepositoriesSection({
  explanation,
  locale,
  related,
  t,
}: {
  explanation: string;
  locale: Locale;
  related: RelatedRepo[];
  t: Dict;
}) {
  return (
    <section className="mt-[clamp(2rem,4vw,3rem)] min-w-0">
      <div className="max-w-[64ch]">
        <h2 className="text-[1.2rem] font-extrabold tracking-tight text-on-surface">{t.repo.relatedRepositories}</h2>
        {related.length > 0 && <p className="mt-2 text-[0.9rem] leading-relaxed text-on-surface-variant">{explanation}</p>}
      </div>
      {related.length > 0 ? (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {related.map((entry) => (
            <li key={entry.full_name}>
              <Link href={localizedPath(locale, `/${entry.full_name}`)} className="group flex h-full min-h-16 items-center justify-between gap-3 rounded-lg bg-surface-container px-4 py-3 transition-colors hover:bg-surface-container-high">
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[0.9rem] font-semibold text-on-surface group-hover:underline group-hover:underline-offset-2" title={entry.full_name}>
                    {entry.owner}/{entry.name}
                  </span>
                  <span className="mt-1 block font-mono text-[0.74rem] text-on-surface-variant">
                    {fmtStars(entry.current_stars, locale)}
                    <Star />
                    {entry.language ? ` · ${entry.language}` : ""}
                  </span>
                </span>
                <span aria-hidden className="shrink-0 font-mono text-[1rem] text-on-surface-variant transition-colors group-hover:text-on-surface">
                  &rarr;
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState message={t.repo.relatedEmpty} />
      )}
    </section>
  );
}

function relatedRepositoriesExplanation(t: Dict, source: "owner" | "language" | "mixed" | "empty", language: string | null): string {
  if (source === "empty") return t.repo.relatedEmpty;
  if (source === "language") return fill(t.repo.relatedByLanguage, { language: language ?? t.repo.unspecifiedLanguage });
  if (source === "mixed") return fill(t.repo.relatedByOwnerAndLanguage, { language: language ?? t.repo.unspecifiedLanguage });
  return t.repo.relatedByOwner;
}

function buildRepoRelatedItems({
  locale,
  owner,
  categories,
  related,
  rankingAppearances,
}: {
  locale: Locale;
  owner: string;
  categories: CategoryLink[];
  related: RelatedRepo[];
  rankingAppearances: RepoHubRankingAppearance[];
}): RelatedPageItem[] {
  const items = new Map<string, RelatedPageItem>();
  addRelatedItem(items, localizedPath(locale, ownerHref(owner)), `/o/${owner}`);
  for (const category of categories.slice(0, 4)) addRelatedItem(items, localizedPath(locale, category.href), category.label);
  for (const repo of related.slice(0, 4)) addRelatedItem(items, localizedPath(locale, `/${repo.full_name}`), repo.full_name);
  for (const appearance of rankingAppearances.slice(0, 3)) {
    addRelatedItem(items, localizedPath(locale, rankingMonthHref(appearance.period)), `${monthYearFromPeriod(locale, appearance.period)} #${appearance.rank}`);
  }
  return [...items.values()];
}

function addRelatedItem(items: Map<string, RelatedPageItem>, href: string, label: string) {
  items.set(href, { href: href as `/${string}`, label });
}

function displayUrl(value: string): string {
  return value.replace(/^https?:\/\//i, "").replace(/\/$/g, "");
}

function buildLocalizedRepoCapsule(t: Dict, locale: Locale, repo: RepoPageEntity, asOf: string): AnswerCapsuleContent {
  const latest = repo.monthly_table.at(-1);
  const language = repo.language ? `${repo.language} ` : "";
  const latestPhrase = latest
    ? fill(t.repo.capsuleLatest, {
        month: monthYearFromPeriod(locale, latest.month),
        stars: signedStars(latest.adds, locale),
      })
    : t.repo.capsuleLatestFallback;
  const text = fill(t.repo.capsule, {
    asOf,
    repo: repo.full_name,
    stars: fmtStars(repo.current_stars, locale),
    language,
    milestones: repoMilestonePhrase(t, locale, repo),
    latest: latestPhrase,
  });
  return { text: withSource(text), asOf, source: ANSWER_CAPSULE_SOURCE };
}

function buildLocalizedRepoFaqs(t: Dict, locale: Locale, repo: RepoPageEntity, asOf: string | null): FaqItem[] {
  const latest = repo.curve.monthly.at(-1);
  const latestPhrase = latest
    ? fill(t.repo.latestMonthlyPoint, {
        month: monthYearFromPeriod(locale, latest[0]),
        stars: signedStars(latest[1], locale),
        total: fmtStars(latest[2], locale),
      })
    : t.repo.monthlyUnavailable;
  const language = repo.language ?? t.repo.unspecifiedLanguage;

  return [
    {
      question: fill(t.repo.faqStarsQuestion, { repo: repo.full_name }),
      answer: asOf
        ? fill(t.repo.faqStarsAnswerWithAsOf, { asOf, repo: repo.full_name, stars: fmtStars(repo.current_stars, locale) })
        : fill(t.repo.faqStarsAnswerNoAsOf, { repo: repo.full_name, stars: fmtStars(repo.current_stars, locale) }),
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
      ...milestones.flatMap((milestone) => {
        const rankingHref = rankingMonthHrefIfRoutable(milestone.date);
        return rankingHref
          ? [
              {
                label: fill(t.repo.milestoneRankingMonth, { milestone: milestone.label }),
                href: localizedPath(locale, rankingHref),
              },
            ]
          : [];
      }),
    ],
    sourceLabel: t.common.source,
  });
}

function repoMilestonePhrase(t: Dict, locale: Locale, repo: RepoPageEntity): string {
  const known = repoMilestoneLabels(t, locale, repo);
  return known.length > 0 ? listLabels(locale, known) : t.repo.milestoneFallback;
}

function repoMilestoneAnswer(t: Dict, locale: Locale, repo: RepoPageEntity): string {
  const known = repoMilestoneLabels(t, locale, repo);
  if (known.length === 0) return fill(t.repo.faqMilestonesAnswerNone, { repo: repo.full_name });
  return fill(t.repo.faqMilestonesAnswerSome, { repo: repo.full_name, milestones: listLabels(locale, known) });
}

function repoMilestoneLabels(t: Dict, locale: Locale, repo: RepoPageEntity): string[] {
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

function signedStars(value: number, locale: Locale): string {
  const prefix = value >= 0 ? "+" : "-";
  return `${prefix}${fmtStars(Math.abs(value), locale)}`;
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
