import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chrome } from "@/app/_explore/Chrome";
import { StarCurve } from "@/app/_explore/StarCurve";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { getOrgEntity, getReposLookup } from "@/lib/data";
import { fmtStars } from "@/lib/format";
import { pageMeta } from "@/lib/seo";
import { parseLang, getDictionary, localePrefix } from "@/lib/i18n";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";

export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string; login: string }> }): Promise<Metadata> {
  const { lang, login: raw } = await params;
  const loc = parseLang(lang);
  if (!loc) return {};
  const login = decodeURIComponent(raw);
  const org = await getOrgEntity(login);
  if (!org) return pageMeta({ title: `${login} — GitHub Star Ranking`, description: `GitHub star history for ${login}.`, path: `/o/${login}`, locale: loc });
  const kind = org.owner_type === "Organization" ? "Organization" : "Developer";
  return pageMeta({
    title: `${org.login} — GitHub ${kind} Star Ranking & History`,
    description: `${org.login} on GitHub: combined star history across ${org.repo_count} tracked ≥10k-star repos — ${org.current_stars_sum.toLocaleString()} total stars, top projects, and all-time ranking.`,
    path: `/o/${org.login}`,
    locale: loc,
  });
}

export default async function OrgPage({ params }: { params: Promise<{ lang: string; login: string }> }) {
  const { lang, login: raw } = await params;
  const loc = parseLang(lang);
  if (!loc) notFound();
  const login = decodeURIComponent(raw);
  const [org, lookup, t] = await Promise.all([getOrgEntity(login), getReposLookup(), getDictionary(loc)]);
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
      <Chrome locale={loc} t={t} />
      <main className={`mx-auto w-full max-w-[60rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <header className="animate-rise">
          <div className="font-mono text-[clamp(1.6rem,5vw,2.6rem)] font-semibold text-on-surface">{org.login}</div>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[0.8rem] text-on-surface-variant">
            <span className="text-[1.6rem] font-extrabold tabular-nums text-primary-fixed-dim">
              {fmtStars(org.current_stars_sum)}
              <span className="text-[0.9rem] text-on-surface-variant"> ★ {t.org.total}</span>
            </span>
            <span>{org.repo_count} {t.org.trackedRepos}</span>
            <span>{org.owner_type === "Organization" ? t.org.organization : t.org.developer}</span>
          </div>
        </header>

        {series.length > 1 && (
          <section className="mt-[clamp(2rem,4vw,3rem)]">
            <h2 className="mb-3 font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">{t.org.history}</h2>
            <StarCurve series={series} milestones={[]} />
          </section>
        )}

        <section className="mt-[clamp(2rem,4vw,3rem)]">
          <h2 className="mb-3 text-[1.2rem] font-extrabold tracking-tight text-on-surface">{t.org.repos}</h2>
          <RankingList rows={members} variant="total" locale={loc} />
        </section>
      </main>
    </>
  );
}
