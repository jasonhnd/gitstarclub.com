import Link from "next/link";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chrome } from "@/app/_explore/Chrome";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { JsonLd } from "@/app/_explore/JsonLd";
import { StarCurve, type Milestone } from "@/app/_explore/StarCurve";
import { ShareButton } from "@/app/_explore/ShareButton";
import { getRepoIdByFullName, getRepoEntity } from "@/lib/data";
import { fmtStars, ymParts, monthLabel } from "@/lib/format";
import { pageMeta } from "@/lib/seo";
import { repoLd } from "@/lib/jsonld";
import { T } from "@/lib/i18n/client";
import { DEFAULT_LOCALE } from "@/lib/i18n";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";
const LOC = DEFAULT_LOCALE;

export const dynamicParams = true;
export const revalidate = false;

// No paths are prebuilt at deploy time (the repo set is large and versioned). Returning an
// empty list makes this a statically-optimized route: an uncached path is rendered on first
// request and then cached (ISR/on-demand SSG) rather than re-rendered on every request.
export function generateStaticParams() {
  return [];
}

const MS: ReadonlyArray<[string, number, "crossed_10k" | "crossed_50k" | "crossed_100k"]> = [
  ["10k", 10000, "crossed_10k"],
  ["50k", 50000, "crossed_50k"],
  ["100k", 100000, "crossed_100k"],
];

export async function generateMetadata({ params }: { params: Promise<{ owner: string; name: string }> }): Promise<Metadata> {
  const { owner, name } = await params;
  const fullName = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
  const id = (await getRepoIdByFullName()).get(fullName.toLowerCase());
  const repo = id !== undefined ? await getRepoEntity(id) : null;
  if (!repo) return pageMeta({ title: `${fullName} — Star History`, description: `GitHub star history for ${fullName}.`, path: `/${fullName}`, locale: "en" });
  return pageMeta({
    title: `${repo.full_name} — Star History & Timeline`,
    description: `Star history for ${repo.full_name}: ${repo.current_stars.toLocaleString()} stars. Growth curve, milestones (10k/50k/100k dates), monthly star gains, and ranking history.`,
    path: `/${repo.full_name}`,
    locale: "en",
    ogImage: `/${repo.full_name}/opengraph-image`, // per-repo OG card (app/[owner]/[name]/opengraph-image.tsx)
  });
}

export default async function RepoPage({ params }: { params: Promise<{ owner: string; name: string }> }) {
  const { owner, name } = await params;
  const loc = LOC;
  const fullName = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
  const id = (await getRepoIdByFullName()).get(fullName.toLowerCase());
  if (id === undefined) notFound();
  const repo = await getRepoEntity(id);
  if (!repo) notFound();

  const series = repo.curve.monthly.map(([period, , totalEnd]) => ({ label: period, total: totalEnd }));
  const milestones: Milestone[] = MS.flatMap(([label, stars, key]) => {
    const date = repo.milestones[key];
    if (!date) return [];
    const monthIndex = series.findIndex((p) => p.label === date.slice(0, 7));
    return monthIndex >= 0 ? [{ stars, label, date, monthIndex }] : [];
  });
  const inflections = (repo.inflections ?? []).flatMap((inf) => {
    const monthIndex = series.findIndex((p) => p.label === inf.period);
    return monthIndex >= 0 ? [{ monthIndex, flow: inf.flow, kind: inf.kind, label: inf.period }] : [];
  });
  const monthly = [...repo.monthly_table].reverse();
  const created = ymParts(repo.created_at);

  return (
    <>
      <Chrome />
      <JsonLd data={repoLd(repo, `/${repo.full_name}`, loc)} />
      <main className={`mx-auto w-full max-w-[72rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs
          items={[
            { path: "nav.home", href: "/" },
            { label: repo.owner, href: `/o/${repo.owner}` },
            { label: repo.name },
          ]}
        />

        <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <header className="animate-rise">
            <div className="flex flex-wrap items-baseline gap-x-1 gap-y-1 font-mono text-[clamp(1.4rem,4vw,2.2rem)]">
              <span className="text-on-surface-variant">{repo.owner} /</span>
              <span className="font-semibold text-on-surface">{repo.name}</span>
            </div>
            {repo.description && (
              <p className="mt-3 max-w-[52ch] text-[clamp(1rem,1.7vw,1.2rem)] text-on-surface-variant">{repo.description}</p>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[0.8rem] text-on-surface-variant">
              <span className="text-[1.6rem] font-extrabold tabular-nums text-primary-fixed-dim">
                {fmtStars(repo.current_stars)}
                <span className="text-[0.9rem] text-on-surface-variant"> ★</span>
              </span>
              {repo.language && <span>{repo.language}</span>}
              <span>
                <T path="repo.created" /> {monthLabel(loc, created.m, "short")} {created.y}
              </span>
              {repo.is_archived && (
                <span className="text-tertiary">
                  <T path="repo.archived" />
                </span>
              )}
            </div>
            <div className="mt-5">
              <ShareButton text={`${repo.full_name} — GitHub star history`} />
            </div>
          </header>

          <aside className="rounded-2xl bg-surface-container px-4 py-4">
            <h2 className="font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">
              <T path="repo.about" />
            </h2>
            {repo.description && <p className="mt-3 text-[0.95rem] leading-relaxed text-on-surface">{repo.description}</p>}
            <dl className="mt-4 grid gap-3 text-[0.86rem]">
              <MetaRow label={<T path="repo.owner" />} value={repo.owner} href={`/o/${repo.owner}`} />
              {repo.language && <MetaRow label="Language" value={repo.language} />}
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
            <a href={`https://github.com/${repo.full_name}`} className="mt-5 inline-flex items-center gap-1 font-semibold text-tertiary transition-colors hover:text-primary hover:underline hover:underline-offset-[3px]">
              <T path="repo.github" /> →
            </a>
          </aside>
        </div>

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
                        <span className="font-extrabold text-primary-fixed-dim">{m.label}</span>
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
                      <Link href={`/rankings/${d.y}/${d.m}`} className="group grid grid-cols-[1fr_auto_auto] items-center gap-4 py-2.5 transition-colors hover:bg-on-surface/5">
                        <span className="font-mono text-[0.9rem] text-on-surface group-hover:underline group-hover:underline-offset-2">
                          {monthLabel(loc, d.m, "short")} {d.y}
                        </span>
                        <span className="font-mono text-[0.85rem] tabular-nums text-on-surface-variant">
                          {row.rank != null ? (
                            <>
                              <T path="repo.rank" /> #{row.rank}
                            </>
                          ) : (
                            ""
                          )}
                        </span>
                        <span className="w-20 text-right font-semibold tabular-nums text-on-surface">+{fmtStars(row.adds)}</span>
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

function MetaRow({ label, value, href, external = false }: { label: ReactNode; value: ReactNode; href?: string; external?: boolean }) {
  const valueNode = href ? (
    <a href={href} className="truncate font-semibold text-tertiary hover:text-primary hover:underline hover:underline-offset-[3px]" {...(external ? { rel: "noreferrer" } : {})}>
      {value}
    </a>
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
