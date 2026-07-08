import Link from "next/link";
import type { ReactNode } from "react";

export type PeriodSwitcherActivePeriod = "all-time" | "year" | "month" | "week";

export type PeriodSwitcherTarget = {
  href: string;
  label: string;
  value: ReactNode;
  badge?: string;
};

export type PeriodSwitcherProps = {
  links: Record<PeriodSwitcherActivePeriod, PeriodSwitcherTarget>;
  activePeriod: PeriodSwitcherActivePeriod;
};

type PeriodLink = {
  period: PeriodSwitcherActivePeriod;
  href: string;
  label: string;
  value: ReactNode;
  badge?: string;
};

export function PeriodSwitcher({ links: targets, activePeriod }: PeriodSwitcherProps) {
  const links: PeriodLink[] = [
    {
      period: "all-time",
      ...targets["all-time"],
    },
    {
      period: "year",
      ...targets.year,
    },
    {
      period: "month",
      ...targets.month,
    },
    {
      period: "week",
      ...targets.week,
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
      {link.badge && <span className={`mt-1 truncate font-mono text-[0.65rem] ${active ? "opacity-75" : "text-on-surface-variant"}`}>{link.badge}</span>}
    </Link>
  );
}
