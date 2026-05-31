import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chrome } from "@/app/_explore/Chrome";
import { StarCurve, type Milestone } from "@/app/_explore/StarCurve";
import { getRepoIdByFullName, getRepoEntity } from "@/lib/data";
import { fmtStars, ymParts, monthLabel } from "@/lib/format";
import { pageMeta } from "@/lib/seo";
import { parseLang, getDictionary, localePrefix } from "@/lib/i18n";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";

export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  return [];
}

const MS: ReadonlyArray<[string, number, "crossed_10k" | "crossed_50k" | "crossed_100k"]> = [
  ["10k", 10000, "crossed_10k"],
  ["50k", 50000, "crossed_50k"],
  ["100k", 100000, "crossed_100k"],
];

export async function generateMetadata({ params }: { params: Promise<{ lang: string; owner: string; name: string }> }): Promise<Metadata> {
  const { lang, owner, name } = await params;
  const loc = parseLang(lang);
  if (!loc) return {};
  const fullName = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
  const id = (await getRepoIdByFullName()).get(fullName.toLowerCase());
  const repo = id !== undefined ? await getRepoEntity(id) : null;
  if (!repo) return pageMeta({ title: `${fullName} — Star History`, description: `GitHub star history for ${fullName}.`, path: `/r/${fullName}`, locale: loc });
  return pageMeta({
    title: `${repo.full_name} — Star History & Timeline`,
    description: `Star history for ${repo.full_name}: ${repo.current_stars.toLocaleString()} stars. Growth curve, milestones (10k/50k/100k dates), monthly star gains, and ranking history.`,
    path: `/r/${repo.full_name}`,
    locale: loc,
  });
}

export default async function RepoPage({ params }: { params: Promise<{ lang: string; owner: string; name: string }> }) {
  const { lang, owner, name } = await params;
  const loc = parseLang(lang);
  if (!loc) notFound();
  const fullName = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
  const id = (await getRepoIdByFullName()).get(fullName.toLowerCase());
  if (id === undefined) notFound();
  const [repo, t] = await Promise.all([getRepoEntity(id), getDictionary(loc)]);
  if (!repo) notFound();
  const lp = localePrefix(loc);

  const series = repo.curve.monthly.map(([period, , totalEnd]) => ({ label: period, total: totalEnd }));
  const milestones: Milestone[] = MS.flatMap(([label, stars, key]) => {
    const date = repo.milestones[key];
    if (!date) return [];
    const monthIndex = series.findIndex((p) => p.label === date.slice(0, 7));
    return monthIndex >= 0 ? [{ stars, label, date, monthIndex }] : [];
  });
  const monthly = [...repo.monthly_table].reverse();
  const created = ymParts(repo.created_at);

  return (
    <>
      <Chrome locale={loc} t={t} />
      <main className={`mx-auto w-full max-w-[60rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
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
              {t.repo.created} {monthLabel(loc, created.m, "short")} {created.y}
            </span>
            {repo.is_archived && <span className="text-tertiary">{t.repo.archived}</span>}
          </div>
        </header>

        {series.length > 1 && (
          <section className="mt-[clamp(2rem,4vw,3rem)]">
            <h2 className="mb-3 font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">{t.repo.history}</h2>
            <StarCurve series={series} milestones={milestones} />
          </section>
        )}

        {milestones.length > 0 && (
          <section className="mt-[clamp(2rem,4vw,3rem)]">
            <h2 className="mb-3 text-[1.2rem] font-extrabold tracking-tight text-on-surface">{t.repo.milestones}</h2>
            <ul className="flex flex-wrap gap-2">
              {milestones.map((m) => {
                const d = ymParts(m.date);
                return (
                  <li key={m.stars}>
                    <Link href={`${lp}/${d.y}/${d.m}`} className="inline-flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-4 py-2 transition-colors hover:bg-surface-container-high">
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
            <h2 className="mb-3 text-[1.2rem] font-extrabold tracking-tight text-on-surface">{t.repo.recent}</h2>
            <ul className="flex flex-col divide-y divide-outline-variant/50">
              {monthly.map((row) => {
                const d = ymParts(row.month);
                return (
                  <li key={row.month}>
                    <Link href={`${lp}/${d.y}/${d.m}`} className="group grid grid-cols-[1fr_auto_auto] items-center gap-4 py-2.5 transition-colors hover:bg-on-surface/5">
                      <span className="font-mono text-[0.9rem] text-on-surface group-hover:underline group-hover:underline-offset-2">
                        {monthLabel(loc, d.m, "short")} {d.y}
                      </span>
                      <span className="font-mono text-[0.85rem] tabular-nums text-on-surface-variant">{row.rank != null ? `${t.repo.rank} #${row.rank}` : ""}</span>
                      <span className="w-20 text-right font-semibold tabular-nums text-on-surface">+{fmtStars(row.adds)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="mt-[clamp(2rem,4vw,3rem)] flex flex-wrap items-center gap-3">
          {repo.topics.map((tp) => (
            <span key={tp} className="rounded-full bg-surface-container-high px-3 py-1 font-mono text-[0.75rem] text-on-surface-variant">
              #{tp}
            </span>
          ))}
          <a href={`https://github.com/${repo.full_name}`} className="ml-auto inline-flex items-center gap-1 font-semibold text-tertiary transition-colors hover:text-primary hover:underline hover:underline-offset-[3px]">
            {t.repo.github} →
          </a>
        </section>
      </main>
    </>
  );
}
