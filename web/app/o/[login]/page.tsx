import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chrome } from "@/app/_explore/Chrome";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { JsonLd } from "@/app/_explore/JsonLd";
import { StarCurve } from "@/app/_explore/StarCurve";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { getOrgEntity, getReposLookup } from "@/lib/data";
import { fmtStars } from "@/lib/format";
import { pageMeta } from "@/lib/seo";
import { orgLd } from "@/lib/jsonld";
import { T } from "@/lib/i18n/client";
import { DEFAULT_LOCALE } from "@/lib/i18n";

const LOC = DEFAULT_LOCALE;

export const dynamicParams = true;
export const revalidate = false;

// No paths are prebuilt at deploy time (the org set is large and versioned). Returning an
// empty list makes this a statically-optimized route: an uncached path is rendered on first
// request and then cached (ISR/on-demand SSG) rather than re-rendered on every request.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ login: string }> }): Promise<Metadata> {
  const { login: raw } = await params;
  const login = decodeURIComponent(raw);
  const org = await getOrgEntity(login);
  if (!org) return pageMeta({ title: `${login} — GitHub Star Ranking`, description: `GitHub star history for ${login}.`, path: `/o/${login}`, locale: "en" });
  const kind = org.owner_type === "Organization" ? "Organization" : "Developer";
  return pageMeta({
    title: `${org.login} — GitHub ${kind} Star Ranking & History`,
    description: `${org.login} on GitHub: combined star history across ${org.repo_count} tracked ≥10k-star repos — ${org.current_stars_sum.toLocaleString()} total stars, top projects, and all-time ranking.`,
    path: `/o/${org.login}`,
    locale: "en",
  });
}

export default async function OrgPage({ params }: { params: Promise<{ login: string }> }) {
  const { login: raw } = await params;
  const loc = LOC;
  const login = decodeURIComponent(raw);
  const [org, lookup] = await Promise.all([getOrgEntity(login), getReposLookup()]);
  if (!org) notFound();

  const series = org.curve.monthly.map(([period, , totalEnd]) => ({ label: period, total: totalEnd }));
  const members: Row[] = org.members
    .map((id) => {
      const m = lookup?.[String(id)];
      return m ? { owner: m.owner, name: m.name, lang: m.language, total: m.current_stars } : null;
    })
    .filter((r): r is Row => r !== null)
    .sort((a, b) => b.total - a.total);

  return (
    <>
      <Chrome />
      <JsonLd data={orgLd(org, `/o/${org.login}`, loc)} />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[60rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs items={[{ path: "nav.home", href: "/" }, { label: org.login }]} />
        <header className="mt-4 animate-rise">
          <h1 className="font-mono text-[clamp(1.6rem,5vw,2.6rem)] font-semibold text-on-surface">{org.login}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[0.8rem] text-on-surface-variant">
            <span className="text-readable-gold text-[1.6rem] font-extrabold tabular-nums">
              {fmtStars(org.current_stars_sum)}
              <span className="text-[0.9rem] text-on-surface-variant"> ★<T path="org.total" /></span>
            </span>
            <span>{org.repo_count} <T path="org.trackedRepos" /></span>
            <span>{org.owner_type === "Organization" ? <T path="org.organization" /> : <T path="org.developer" />}</span>
          </div>
        </header>

        {series.length > 1 && (
          <section className="mt-[clamp(2rem,4vw,3rem)]">
            <h2 className="mb-3 font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">
              <T path="org.history" />
            </h2>
            <StarCurve series={series} milestones={[]} />
          </section>
        )}

        <section className="mt-[clamp(2rem,4vw,3rem)]">
          <h2 className="mb-3 text-[1.2rem] font-extrabold tracking-tight text-on-surface">
            <T path="org.repos" />
          </h2>
          <RankingList rows={members} variant="total" locale={loc} />
        </section>
      </main>
    </>
  );
}
