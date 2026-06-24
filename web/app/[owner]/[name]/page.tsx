import Link from "next/link";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Chrome } from "@/app/_explore/Chrome";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { JsonLd } from "@/app/_explore/JsonLd";
import { StarCurve } from "@/app/_explore/StarCurve";
import { ShareButton } from "@/app/_explore/ShareButton";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { getRepoIdByFullNameDaily, getRepoEntityDaily, getAliasMapDaily, getReposLookupDaily, getCategoryAssignments, getCategoryRegistry } from "@/lib/data";
import type { CategoryAssignments, CategoryRegistry, RepoLookupEntry } from "@/lib/contracts";
import { fmtStars, ymParts, monthLabel } from "@/lib/format";
import { pageMeta } from "@/lib/seo";
import { repoLd } from "@/lib/jsonld";
import { exactRepoMilestones } from "@/lib/repo-milestones";
import { resolveRepoRoute } from "@/lib/repo-route";
import { T } from "@/lib/i18n/client";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { CATEGORY_DIMENSIONS, categoryLanguageNamesFromRepository, slugifyCategoryPart } from "@/lib/categories/rules";

const LOC = DEFAULT_LOCALE;

export const dynamicParams = true;
export const revalidate = 86400;

// No paths are prebuilt at deploy time (the repo set is large and versioned). Returning an
// empty list makes this a statically-optimized route: an uncached path is rendered on first
// request and then periodically refreshed rather than re-rendered on every request.
export function generateStaticParams() {
  return [];
}


// Resolve a URL slug → repo id. On a miss, if the slug is a former name of a still-tracked repo
// (GitHub rename, e.g. facebook/react → react/react), 308-redirect to its current slug; otherwise
// return undefined so the caller can 404.
async function resolveRepoId(fullName: string): Promise<number | undefined> {
  const idsByFullName = await getRepoIdByFullNameDaily();
  const direct = resolveRepoRoute(fullName, idsByFullName, null, null);
  if (direct.kind === "found") return direct.id;

  const resolution = resolveRepoRoute(fullName, idsByFullName, await getAliasMapDaily(), await getReposLookupDaily());
  if (resolution.kind === "found") return resolution.id;
  if (resolution.kind === "redirect") permanentRedirect(resolution.location);
  return undefined;
}

export async function generateMetadata({ params }: { params: Promise<{ owner: string; name: string }> }): Promise<Metadata> {
  const { owner, name } = await params;
  const fullName = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
  const id = await resolveRepoId(fullName);
  const repo = id !== undefined ? await getRepoEntityDaily(id) : null;
  if (!repo) return pageMeta({ title: `${fullName} — Star History`, description: `GitHub star history for ${fullName}.`, path: `/${fullName}`, locale: "en" });
  return pageMeta({
    title: `${repo.full_name} — Star History & Timeline`,
    description: `Star history for ${repo.full_name}: ${repo.current_stars.toLocaleString()} stars. Growth curve, exact 10k/50k/100k milestones, monthly star gains, and ranking history.`,
    path: `/${repo.full_name}`,
    locale: "en",
    ogImage: `/${repo.full_name}/opengraph-image`, // per-repo OG card (app/[owner]/[name]/opengraph-image.tsx)
  });
}

export default async function RepoPage({ params }: { params: Promise<{ owner: string; name: string }> }) {
  const { owner, name } = await params;
  const loc = LOC;
  const fullName = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
  const id = await resolveRepoId(fullName);
  if (id === undefined) notFound();
  const [repo, lookup, assignments, registry] = await Promise.all([
    getRepoEntityDaily(id),
    getReposLookupDaily(),
    getCategoryAssignments(),
    getCategoryRegistry(),
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

  return (
    <>
      <Chrome />
      <JsonLd data={repoLd(repo, `/${repo.full_name}`, loc)} />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[72rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs
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
                <Link href={languageHref(languages[0].name)} className="text-tertiary hover:text-primary hover:underline hover:underline-offset-[3px]">
                  {languages[0].name}
                </Link>
              )}
              <span>
                <T path="repo.created" /> {monthLabel(loc, created.m, "short")} {created.y}
              </span>
              {repo.is_archived && (
                <span className="text-tertiary">
                  <T path="repo.archived" />
                </span>
              )}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <ShareButton text={`${repo.full_name} — GitHub star history`} />
              <Link
                href={`/compare?repos=${encodeURIComponent(repo.full_name)}`}
                className="inline-flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-4 py-2 font-mono text-[0.78rem] text-on-surface transition-colors hover:bg-surface-container-high"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M4 18v-6m0 0V6m0 6h16m0 0v6m0-6V6" strokeLinecap="round" />
                </svg>
                <T path="compare.addToCompare" />
              </Link>
            </div>
          </header>

          <aside className="rounded-2xl bg-surface-container px-4 py-4">
            <h2 className="font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">
              <T path="repo.about" />
            </h2>
            {repo.description && <p className="mt-3 text-[0.95rem] leading-relaxed text-on-surface">{repo.description}</p>}
            <dl className="mt-4 grid gap-3 text-[0.86rem]">
              <MetaRow label={<T path="repo.owner" />} value={repo.owner} href={`/o/${repo.owner}`} />
              {languages.length > 0 && (
                <MetaRow label={<T path={languages.length > 1 ? "repo.languages" : "repo.language"} />} value={<LanguageLinks languages={languages} totalSize={languageTotalSize} />} wrap />
              )}
              {repo.license && <MetaRow label={<T path="repo.license" />} value={repo.license} />}
              {repo.homepage_url && <MetaRow label={<T path="repo.homepage" />} value={repo.homepage_url.replace(/^https?:\/\//, "")} href={repo.homepage_url} external />}
              <MetaRow
                label={<T path="repo.latestRelease" />}
                value={repo.latest_release ? repo.latest_release.name || repo.latest_release.tag_name : <T path="repo.noRelease" />}
                href={repo.latest_release?.url ?? undefined}
                external={Boolean(repo.latest_release?.url)}
              />
            </dl>
            {repo.topics.length > 0 && (
              <div className="mt-5">
                <h3 className="font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">
                  <T path="repo.topics" />
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
              <T path="repo.github" /> →
            </a>
          </aside>
        </div>

        <RepoLinkHub owner={repo.owner} categories={categoryLinks} related={related} />

        <div className="max-w-[60rem]">
          {series.length > 1 && (
            <section className="mt-[clamp(2rem,4vw,3rem)]">
              <h2 className="mb-3 font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">
                <T path="repo.history" />
              </h2>
              <StarCurve series={series} milestones={milestones} inflections={inflections} />
            </section>
          )}

          {milestones.length > 0 && (
            <section className="mt-[clamp(2rem,4vw,3rem)]">
              <h2 className="mb-3 text-[1.2rem] font-extrabold tracking-tight text-on-surface">
                <T path="repo.milestones" />
              </h2>
              <ul className="flex flex-wrap gap-2">
                {milestones.map((m) => {
                  const d = ymParts(m.date);
                  return (
                    <li key={m.stars}>
                      <Link href={`/rankings/${d.y}/${d.m}`} className="inline-flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-4 py-2 transition-colors hover:bg-surface-container-high">
                        <span className="text-readable-gold font-extrabold">{m.label}</span>
                        <span className="font-mono text-[0.8rem] text-on-surface-variant">
                          {monthLabel(loc, d.m, "short")} {d.y}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {monthly.length > 0 && (
            <section className="mt-[clamp(2rem,4vw,3rem)]">
              <h2 className="mb-3 text-[1.2rem] font-extrabold tracking-tight text-on-surface">
                <T path="repo.recent" />
              </h2>
              <ul className="flex flex-col divide-y divide-outline-variant/50">
                {monthly.map((row) => {
                  const d = ymParts(row.month);
                  return (
                    <li key={row.month}>
                      <Link href={`/rankings/${d.y}/${d.m}`} className="group grid grid-cols-1 items-start gap-y-1 py-3 transition-colors hover:bg-on-surface/5 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-4 sm:py-2.5">
                        <span className="min-w-0 font-mono text-[0.9rem] text-on-surface group-hover:underline group-hover:underline-offset-2">
                          {monthLabel(loc, d.m, "short")} {d.y}
                        </span>
                        <span className="font-mono text-[0.78rem] tabular-nums text-on-surface-variant sm:text-[0.85rem]">
                          {row.rank != null ? (
                            <>
                              <T path="repo.rank" /> #{row.rank}
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
      </main>
    </>
  );
}

type RepoLanguage = { name: string; size?: number | null; color?: string | null };
type CategoryLink = { id: string; label: string; href: string };
type RelatedRepo = Pick<RepoLookupEntry, "full_name" | "owner" | "name" | "language" | "current_stars">;

function repoLanguageEntries(repo: { language: string | null; languages?: RepoLanguage[] }): RepoLanguage[] {
  const primarySlug = repo.language ? slugifyCategoryPart(repo.language) : null;
  const breakdown = repo.languages ?? [];
  const primaryEntry = primarySlug ? breakdown.find((language) => slugifyCategoryPart(language.name) === primarySlug) ?? { name: repo.language!, size: null, color: null } : null;
  const source = primaryEntry ? [primaryEntry, ...breakdown.filter((language) => slugifyCategoryPart(language.name) !== primarySlug)] : breakdown;
  const categoryLanguageSlugs = new Set(categoryLanguageNamesFromRepository(repo).map(slugifyCategoryPart));
  const seen = new Set<string>();
  return source.filter((language) => {
    const name = language.name.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return false;
    if (!categoryLanguageSlugs.has(slugifyCategoryPart(name))) return false;
    seen.add(key);
    return true;
  });
}

function languageHref(name: string): string {
  return `/categories/language/${slugifyCategoryPart(name)}`;
}

function categoryHref(dimension: string, slug: string): string {
  return `/categories/${dimension}/${slug}`;
}

function repoCategoryLinks(
  repoId: number,
  assignments: CategoryAssignments | null,
  registry: CategoryRegistry | null,
  languages: RepoLanguage[],
): CategoryLink[] {
  const links = new Map<string, CategoryLink>();
  for (const language of languages.slice(0, 3)) {
    const slug = slugifyCategoryPart(language.name);
    links.set(`language/${slug}`, { id: `language/${slug}`, label: language.name, href: languageHref(language.name) });
  }

  const assignment = assignments?.repositories[String(repoId)];
  if (!assignment || !registry) return [...links.values()].slice(0, 8);

  const registryById = new Map(
    registry.dimensions.flatMap((dimension) =>
      dimension.categories.filter((category) => category.public).map((category) => [category.id, category] as const),
    ),
  );

  for (const dimension of CATEGORY_DIMENSIONS) {
    for (const id of assignment[dimension]) {
      const category = registryById.get(id);
      if (!category || links.has(category.id)) continue;
      links.set(category.id, {
        id: category.id,
        label: category.label,
        href: categoryHref(category.dimension, category.slug),
      });
    }
  }

  return [...links.values()].slice(0, 8);
}

function relatedRepositories(
  repo: { full_name: string; owner: string; language: string | null },
  lookup: Record<string, RepoLookupEntry> | null,
  limit = 6,
): RelatedRepo[] {
  if (!lookup) return [];
  const rows = Object.values(lookup).filter((entry) => entry.full_name !== repo.full_name);
  const sort = (a: RepoLookupEntry, b: RepoLookupEntry) => b.current_stars - a.current_stars || a.full_name.localeCompare(b.full_name);
  const seen = new Set<string>();
  const related: RelatedRepo[] = [];

  for (const entry of rows.filter((candidate) => candidate.owner === repo.owner).sort(sort)) {
    if (seen.has(entry.full_name)) continue;
    seen.add(entry.full_name);
    related.push(entry);
  }

  if (repo.language) {
    for (const entry of rows.filter((candidate) => candidate.language === repo.language && candidate.owner !== repo.owner).sort(sort)) {
      if (seen.has(entry.full_name)) continue;
      seen.add(entry.full_name);
      related.push(entry);
      if (related.length >= limit) break;
    }
  }

  return related.slice(0, limit);
}

function RepoLinkHub({ owner, categories, related }: { owner: string; categories: CategoryLink[]; related: RelatedRepo[] }) {
  return (
    <section aria-labelledby="repo-link-hub" className="mt-[clamp(1.75rem,3.5vw,2.5rem)] border-y border-outline-variant py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="repo-link-hub" className="text-[1.05rem] font-extrabold text-on-surface">
          Explore related pages
        </h2>
        <Link href="/categories" className="text-readable-gold font-mono text-[0.78rem] hover:underline">
          Categories
        </Link>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,1.4fr)]">
        <div className="min-w-0">
          <p className="font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">Owner</p>
          <Link href={`/o/${owner}`} className="text-readable-gold mt-2 inline-block max-w-full truncate font-mono text-[0.9rem] font-semibold hover:underline" title={owner}>
            /o/{owner}
          </Link>
        </div>
        {categories.length > 0 && (
          <div className="min-w-0">
            <p className="font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">Categories</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {categories.map((category) => (
                <Link
                  key={category.id}
                  href={category.href}
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
            <p className="font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">Related repositories</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {related.map((entry) => (
                <Link
                  key={entry.full_name}
                  href={`/${entry.full_name}`}
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

function LanguageLinks({ languages, totalSize }: { languages: RepoLanguage[]; totalSize: number }) {
  const total = totalSize || languages.reduce((sum, language) => sum + Math.max(0, language.size ?? 0), 0);
  return (
    <div className="flex flex-wrap gap-2">
      {languages.map((language) => {
        const share = total > 0 && language.size ? Math.round((language.size / total) * 1000) / 10 : null;
        return (
          <Link
            key={language.name}
            href={languageHref(language.name)}
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
