import Link from "next/link";
import { Chrome } from "../../../_explore/Chrome";
import { StarCurve } from "../../../_explore/StarCurve";
import { REPOS, MONTH_NAMES, repoDetail, fmtK } from "../../../_explore/data";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";

export function generateStaticParams() {
  return REPOS.map((r) => ({ owner: r.owner, name: r.name }));
}

function ym(label: string): { y: number; m: number; pretty: string } {
  const [y, m] = label.split("-").map(Number);
  return { y, m, pretty: `${MONTH_NAMES[m - 1].slice(0, 3)} ${y}` };
}

export default async function RepoPage({
  params,
}: {
  params: Promise<{ owner: string; name: string }>;
}) {
  const { owner, name } = await params;
  const repo = repoDetail(decodeURIComponent(owner), decodeURIComponent(name));
  const created = ym(repo.createdAt);

  return (
    <>
      <Chrome />
      <main className={`mx-auto w-full max-w-[60rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <header className="animate-rise">
          <div className="flex flex-wrap items-baseline gap-x-1 gap-y-1 font-mono text-[clamp(1.4rem,4vw,2.2rem)]">
            <span className="text-on-surface-variant">{repo.owner} /</span>
            <span className="font-semibold text-on-surface">{repo.name}</span>
          </div>
          <p className="mt-3 max-w-[52ch] text-[clamp(1rem,1.7vw,1.2rem)] text-on-surface-variant">
            {repo.description}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[0.8rem] text-on-surface-variant">
            <span className="text-[1.6rem] font-extrabold tabular-nums text-primary-fixed-dim">
              {fmtK(repo.total)}
              <span className="text-[0.9rem] text-on-surface-variant"> ★</span>
            </span>
            <span>{repo.lang}</span>
            <span>created {created.pretty}</span>
            <span>synced 2026-05-29 · 14:30 JST</span>
          </div>
        </header>

        <section className="mt-[clamp(2rem,4vw,3rem)]">
          <h2 className="mb-3 font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">
            Star history
          </h2>
          <StarCurve series={repo.series} milestones={repo.milestones} />
        </section>

        {repo.milestones.length > 0 && (
          <section className="mt-[clamp(2rem,4vw,3rem)]">
            <h2 className="mb-3 text-[1.2rem] font-extrabold tracking-tight text-on-surface">Milestones</h2>
            <ul className="flex flex-wrap gap-2">
              {repo.milestones.map((m) => {
                const d = ym(m.date);
                return (
                  <li key={m.stars}>
                    <Link
                      href={`/${d.y}/${d.m}`}
                      className="inline-flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-4 py-2 transition-colors hover:bg-surface-container-high"
                    >
                      <span className="font-extrabold text-primary-fixed-dim">{m.label}</span>
                      <span className="font-mono text-[0.8rem] text-on-surface-variant">{d.pretty}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="mt-[clamp(2rem,4vw,3rem)]">
          <h2 className="mb-3 text-[1.2rem] font-extrabold tracking-tight text-on-surface">
            Recent months
          </h2>
          <ul className="flex flex-col divide-y divide-outline-variant/50">
            {repo.monthly.map((row) => {
              const d = ym(row.month);
              return (
                <li key={row.month}>
                  <Link
                    href={`/${d.y}/${d.m}`}
                    className="group grid grid-cols-[1fr_auto_auto] items-center gap-4 py-2.5 transition-colors hover:bg-on-surface/5"
                  >
                    <span className="font-mono text-[0.9rem] text-on-surface group-hover:underline group-hover:underline-offset-2">
                      {d.pretty}
                    </span>
                    <span className="font-mono text-[0.85rem] tabular-nums text-on-surface-variant">
                      rank #{row.rank}
                    </span>
                    <span className="w-20 text-right font-semibold tabular-nums text-on-surface">
                      +{fmtK(row.gained)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="mt-[clamp(2rem,4vw,3rem)] flex flex-wrap items-center gap-3">
          {repo.topics.map((t) => (
            <span
              key={t}
              className="rounded-full bg-surface-container-high px-3 py-1 font-mono text-[0.75rem] text-on-surface-variant"
            >
              #{t}
            </span>
          ))}
          <a
            href={`https://github.com/${repo.owner}/${repo.name}`}
            className="ml-auto inline-flex items-center gap-1 font-semibold text-tertiary transition-colors hover:text-primary hover:underline hover:underline-offset-[3px]"
          >
            View on GitHub →
          </a>
        </section>
      </main>
    </>
  );
}
