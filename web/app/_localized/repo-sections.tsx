import Link from "next/link";
import { ShareableSnippet, type ShareableSnippetLabels } from "@/app/_explore/ShareableSnippet";
import { StarCurve, type CurveInflection, type Milestone } from "@/app/_explore/StarCurve";
import { monthLabel, ymParts } from "@/lib/format";
import type { Dict, Locale } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/routing";
import type { ShareableSnippetContent } from "@/lib/shareable-snippets";
import { rankingMonthHrefIfRoutable } from "@/lib/repo-page";

type RepoSeriesPoint = { label: string; total: number };

export function RepoHistorySection({
  inflections,
  locale,
  milestones,
  series,
  t,
}: {
  inflections: CurveInflection[];
  locale: Locale;
  milestones: Milestone[];
  series: RepoSeriesPoint[];
  t: Dict;
}) {
  if (series.length <= 1) return null;
  return (
    <section className="mt-[clamp(2rem,4vw,3rem)]">
      <h2 className="mb-3 font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">{t.repo.history}</h2>
      <StarCurve series={series} milestones={milestones} inflections={inflections} labels={{ ariaLabel: t.a11y.starHistory }} locale={locale} />
    </section>
  );
}

export function RepoMilestonesSection({
  locale,
  milestoneSnippet,
  milestones,
  snippetLabels,
  t,
}: {
  locale: Locale;
  milestoneSnippet: ShareableSnippetContent | null;
  milestones: Milestone[];
  snippetLabels: ShareableSnippetLabels;
  t: Dict;
}) {
  if (milestones.length === 0) return null;
  const href = (path: string) => localizedPath(locale, path);
  return (
    <section className="mt-[clamp(2rem,4vw,3rem)]">
      <h2 className="mb-3 text-[1.2rem] font-extrabold tracking-tight text-on-surface">{t.repo.milestones}</h2>
      <ul className="flex flex-wrap gap-2">
        {milestones.map((milestone) => {
          const d = ymParts(milestone.date);
          const rankingHref = rankingMonthHrefIfRoutable(milestone.date);
          const chip = (
            <>
              <span className="text-readable-gold font-extrabold">{milestone.label}</span>
              <span className="font-mono text-[0.8rem] text-on-surface-variant">
                {monthLabel(locale, d.m, "short")} {d.y}
              </span>
            </>
          );
          return (
            <li key={milestone.stars}>
              {rankingHref ? (
                <Link href={href(rankingHref)} className="inline-flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-4 py-2 transition-colors hover:bg-surface-container-high">
                  {chip}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-4 py-2">
                  {chip}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {milestoneSnippet && <ShareableSnippet snippet={milestoneSnippet} labels={snippetLabels} className="mt-4" />}
    </section>
  );
}
