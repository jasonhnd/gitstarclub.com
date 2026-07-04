import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chrome } from "@/app/_explore/Chrome";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { FaqBlock } from "@/app/_explore/FaqBlock";
import { JsonLd } from "@/app/_explore/JsonLd";
import { StarCurve } from "@/app/_explore/StarCurve";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { ShareableSnippet } from "@/app/_explore/ShareableSnippet";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { DAILY_BASE_VIEW_TTL_MS, getMeta, getOrgEntityDaily, getReposLookupDaily } from "@/lib/data";
import type { OrgEntity } from "@/lib/contracts";
import { fmtStars } from "@/lib/format";
import { pageMeta } from "@/lib/seo";
import { orgLd, type FaqItem } from "@/lib/jsonld";
import { ANSWER_CAPSULE_SOURCE, resolveDataAsOfFromMeta, type AnswerCapsuleContent } from "@/lib/geo-capsules";
import { absoluteSnippetUrl, type ShareableSnippetContent } from "@/lib/shareable-snippets";
import { getDictionary, type Dict, type Locale } from "@/lib/i18n";
import { localizedPath, toBcp47Locale } from "@/lib/i18n/routing";
import { repositoryTableLabels } from "./routing";

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
  const asOf = resolveDataAsOfFromMeta(meta, org.curve.recent_daily.at(-1)?.[0], org.curve.monthly.at(-1)?.[0]);
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
      <JsonLd data={orgLd(org, routePath, language)} />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[60rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs locale={locale} dictionary={t} items={[{ path: "nav.home", href: "/" }, { label: org.login }]} />
        <header className="mt-4 animate-rise">
          <h1 className="font-mono text-[clamp(1.6rem,5vw,2.6rem)] font-semibold text-on-surface">{org.login}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[0.8rem] text-on-surface-variant">
            <span className="text-readable-gold text-[1.6rem] font-extrabold tabular-nums">
              {fmtStars(org.current_stars_sum)}
              <span className="text-[0.9rem] text-on-surface-variant"> ★{t.org.total}</span>
            </span>
            <span>{org.repo_count.toLocaleString(language)} {t.org.trackedRepos}</span>
            <span>{org.owner_type === "Organization" ? t.org.organization : t.org.developer}</span>
          </div>
        </header>

        {capsule && <AnswerCapsule capsule={capsule} labels={capsuleLabels} className="mt-[clamp(1.75rem,3.5vw,2.5rem)]" />}
        {snippet && <ShareableSnippet snippet={snippet} labels={snippetLabels} className="mt-[clamp(1.75rem,3.5vw,2.5rem)]" />}

        {series.length > 1 && (
          <section className="mt-[clamp(2rem,4vw,3rem)]">
            <h2 className="mb-3 font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">
              {t.org.history}
            </h2>
            <StarCurve series={series} milestones={[]} labels={{ ariaLabel: t.a11y.starHistory }} />
          </section>
        )}

        <section className="mt-[clamp(2rem,4vw,3rem)]">
          <h2 className="mb-3 text-[1.2rem] font-extrabold tracking-tight text-on-surface">
            {t.org.repos}
          </h2>
          <RankingList rows={members} variant="total" locale={locale} tableCaption={fill(t.org.memberTableCaption, { login: org.login })} labels={repositoryTableLabels(t)} />
        </section>

        <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
      </main>
    </>
  );
}

function buildLocalizedOrgCapsule(t: Dict, language: string, org: OrgEntity, asOf: string): AnswerCapsuleContent {
  const kind = org.owner_type === "Organization" ? t.org.organization : t.org.developer;
  const text = fill(t.org.capsule, {
    asOf,
    login: org.login,
    stars: fmtStars(org.current_stars_sum),
    repos: org.repo_count.toLocaleString(language),
    kind,
  });
  return { text: withSource(text), asOf, source: ANSWER_CAPSULE_SOURCE };
}

function buildLocalizedOrgFaqs(t: Dict, language: string, org: OrgEntity, members: readonly Row[], asOf: string | null): FaqItem[] {
  const kind = org.owner_type === "Organization" ? t.org.organization : t.org.developer;
  const lead = members[0];
  const leadAnswer = lead
    ? fill(t.org.faqLeadAnswer, { repo: repoName(lead), login: org.login, stars: fmtStars(lead.total) })
    : fill(t.org.faqLeadFallback, { login: org.login });

  return [
    {
      question: fill(t.org.faqStarsQuestion, { login: org.login }),
      answer: asOf
        ? fill(t.org.faqStarsAnswerWithAsOf, {
            asOf,
            login: org.login,
            stars: fmtStars(org.current_stars_sum),
            repos: org.repo_count.toLocaleString(language),
          })
        : fill(t.org.faqStarsAnswerNoAsOf, {
            login: org.login,
            stars: fmtStars(org.current_stars_sum),
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
          top.map((row) => fill(t.org.totalSnippetLeader, { repo: repoName(row), stars: fmtStars(row.total) })),
        ),
      })
    : "";
  const text = fill(t.org.totalSnippetText, {
    asOf,
    login: org.login,
    stars: fmtStars(org.current_stars_sum),
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
