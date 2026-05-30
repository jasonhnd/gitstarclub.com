import Link from "next/link";
import type { CSSProperties } from "react";
import { Chrome } from "../_explore/Chrome";
import { RankingList, type Row } from "../_explore/RankingList";
import { getAllTime, getReposLookup, getOrgsLookup, joinRepoRank, joinOrgRank } from "@/lib/data";
import { fmtStars } from "@/lib/format";
import { pageMeta } from "@/lib/seo";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";

export const metadata = pageMeta({
  title: "All-Time GitHub Star Rankings — Most-Starred Repos & Orgs",
  description: "The all-time most-starred GitHub repositories and organizations. Top 100 by total stars across 11 years.",
  path: "/rankings",
});

export const revalidate = false; // core page; cron revalidates

export default async function RankingsPage() {
  const [repoRank, orgRank, repoLk, orgLk] = await Promise.all([
    getAllTime("repo"),
    getAllTime("org"),
    getReposLookup(),
    getOrgsLookup(),
  ]);
  const repoRows: Row[] =
    repoRank && repoLk
      ? joinRepoRank(repoRank.items, repoLk).map((r) => ({ owner: r.owner, name: r.name, lang: r.language, total: r.current_stars }))
      : [];
  const orgs = orgRank && orgLk ? joinOrgRank(orgRank.items, orgLk) : [];

  return (
    <>
      <Chrome />
      <main className={`mx-auto w-full max-w-[68rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <h1 className="animate-rise text-[clamp(2rem,6vw,3.5rem)] font-extrabold leading-none tracking-[-0.03em] text-on-surface">
          All-time rankings
        </h1>
        <p className="mt-3 max-w-[46ch] text-[clamp(0.95rem,1.6vw,1.15rem)] text-on-surface-variant">
          The largest repositories and organizations by current stars.
        </p>

        <div className="mt-[clamp(2rem,4vw,3rem)] grid gap-x-10 gap-y-10 md:grid-cols-2">
          <section>
            <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">Repositories</h2>
            <RankingList rows={repoRows} variant="total" />
          </section>
          <section>
            <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">Organizations</h2>
            <ol className="flex flex-col">
              {orgs.map((o, i) => (
                <li key={o.login}>
                  <Link
                    href={`/o/${o.login}`}
                    className="group flex animate-rise items-center gap-4 rounded-2xl px-3 py-3 transition-[background-color,transform] duration-200 ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:bg-on-surface/5 active:scale-[0.985]"
                    style={{ animationDelay: `${0.04 * i}s` } as CSSProperties}
                  >
                    <span className="w-9 shrink-0 text-right text-[1.5rem] font-extrabold tabular-nums text-primary-fixed-dim">
                      {o.rank}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="truncate font-mono text-[0.95rem] font-semibold text-on-surface group-hover:underline group-hover:underline-offset-2">
                        {o.login}
                      </span>
                      <div className="font-mono text-[0.68rem] text-on-surface-variant">{o.repo_count} repos</div>
                    </div>
                    <div className="shrink-0 text-right text-[1.05rem] font-extrabold tabular-nums text-on-surface">
                      {fmtStars(o.current_stars_sum)}★
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </main>
    </>
  );
}
