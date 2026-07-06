import Link from "next/link";
import type { ReactNode } from "react";

export type PeriodSwitcherActivePeriod = "all-time" | "year" | "month" | "week";

export type PeriodSwitcherProps = {
  allTimeHref: string;
  currentYear: number;
  currentMonth: number;
  currentWeek: number;
  activePeriod: PeriodSwitcherActivePeriod;
};

type PeriodLink = {
  period: PeriodSwitcherActivePeriod;
  href: string;
  label: string;
  value: ReactNode;
};

export function PeriodSwitcher({
  allTimeHref,
  currentYear,
  currentMonth,
  currentWeek,
  activePeriod,
}: PeriodSwitcherProps) {
  const rankingsHref = allTimeHref.replace(/\/+$/, "") || "/rankings";
  const weekSegment = String(currentWeek).padStart(2, "0");
  const links: PeriodLink[] = [
    {
      period: "all-time",
      href: rankingsHref,
      label: "All-time",
      value: "Full history",
    },
    {
      period: "year",
      href: `${rankingsHref}/${currentYear}`,
      label: "Year",
      value: currentYear,
    },
    {
      period: "month",
      href: `${rankingsHref}/${currentYear}/${currentMonth}`,
      label: "Month",
      value: `${currentYear} / ${currentMonth}`,
    },
    {
      period: "week",
      href: `${rankingsHref}/${currentYear}/W${weekSegment}`,
      label: "Week",
      value: `${currentYear} / W${weekSegment}`,
    },
  ];

  return (
    <nav aria-label="Ranking period" className="grid gap-2 sm:grid-cols-4">
      {links.map((link) => (
        <PeriodSwitcherLink key={link.period} link={link} active={link.period === activePeriod} />
      ))}
    </nav>
  );
}

function PeriodSwitcherLink({ link, active }: { link: PeriodLink; active: boolean }) {
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-16 flex-col justify-center rounded-2xl px-4 py-3 transition-[background-color,transform] duration-200 ease-[var(--ease-spring)] hover:-translate-y-0.5 ${
        active ? "bg-primary-container text-on-primary-container" : "bg-surface-container text-on-surface hover:bg-surface-container-high"
      }`}
    >
      <span className={`font-mono text-[0.7rem] uppercase tracking-wider ${active ? "" : "text-on-surface-variant"}`}>{link.label}</span>
      <span className="mt-1 truncate text-[1rem] font-extrabold">{link.value}</span>
    </Link>
  );
}
