import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Chrome } from "@/app/_explore/Chrome";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { FaqBlock } from "@/app/_explore/FaqBlock";
import { JsonLd } from "@/app/_explore/JsonLd";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { DAILY_BASE_VIEW_TTL_MS, getRepoIdByFullNameDaily, getRepoEntityDaily, getAliasMapDaily, getReposLookupDaily, getCategoryAssignments, getCategoryRegistry, getMeta } from "@/lib/data";
import type { RepoEntity } from "@/lib/contracts";
import { fmtStars, ymParts, monthYearLabel } from "@/lib/format";
import { pageMeta } from "@/lib/seo";
import { repoLd, type FaqItem } from "@/lib/jsonld";
import { exactRepoMilestones, type ExactRepoMilestone } from "@/lib/repo-milestones";
import { resolveRepoRoute } from "@/lib/repo-route";
import { ANSWER_CAPSULE_SOURCE, resolveDataAsOfFromMeta, type AnswerCapsuleContent } from "@/lib/geo-capsules";
import { absoluteSnippetUrl, type ShareableSnippetContent } from "@/lib/shareable-snippets";
import { getDictionary, type Dict, type Locale } from "@/lib/i18n";
import { localizedPath, toBcp47Locale } from "@/lib/i18n/routing";
import { relatedRepositories, repoCategoryLinks, repoLanguageEntries } from "@/lib/repo-page";
import { RepoAboutPanel, RepoHeaderSection, RepoHistorySection, RepoLinkHub, RepoMilestonesSection, RepoRecentSection } from "./repo-sections";


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
          <RepoHeaderSection created={created} languages={languages} locale={locale} repo={repo} t={t} />
          <RepoAboutPanel languageTotalSize={languageTotalSize} languages={languages} locale={locale} repo={repo} t={t} />
        </div>

        {capsule && <AnswerCapsule capsule={capsule} labels={capsuleLabels} className="mt-[clamp(1.75rem,3.5vw,2.5rem)]" />}

        <RepoLinkHub owner={repo.owner} categories={categoryLinks} related={related} locale={locale} t={t} />

        <div className="max-w-[60rem]">
          <RepoHistorySection series={series} milestones={milestones} inflections={inflections} t={t} />
          <RepoMilestonesSection locale={locale} milestones={milestones} milestoneSnippet={milestoneSnippet} snippetLabels={snippetLabels} t={t} />
          <RepoRecentSection locale={locale} monthly={monthly} t={t} />
        </div>

        <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
      </main>
    </>
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
