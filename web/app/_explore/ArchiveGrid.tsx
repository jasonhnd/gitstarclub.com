import Link from "next/link";
import type { ReactNode } from "react";

export type ArchiveGridPeriodType = "all-time" | "year" | "month" | "week" | (string & {});

export type ArchiveGridChildLink = {
  label: ReactNode;
  href: string;
  count?: ReactNode;
};

export type ArchiveGridItem = {
  label: ReactNode;
  description?: ReactNode;
  href: string;
  count?: ReactNode;
  childrenLinks?: readonly ArchiveGridChildLink[];
};

export type ArchiveGridHrefContext = {
  item: ArchiveGridItem | ArchiveGridChildLink;
  periodType: ArchiveGridPeriodType;
  activePeriod: string;
};

export type ArchiveGridGetHref = (href: string, context: ArchiveGridHrefContext) => string;

export function ArchiveGrid({
  items,
  periodType,
  activePeriod,
  getHref,
}: {
  items: readonly ArchiveGridItem[];
  periodType: ArchiveGridPeriodType;
  activePeriod: string;
  getHref: ArchiveGridGetHref;
}) {
  if (items.length === 0) return null;

  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4" data-archive-grid={periodType}>
      {items.map((item) => (
        <ArchiveGridCard key={item.href} item={item} periodType={periodType} activePeriod={activePeriod} getHref={getHref} />
      ))}
    </div>
  );
}

function ArchiveGridCard({
  item,
  periodType,
  activePeriod,
  getHref,
}: {
  item: ArchiveGridItem;
  periodType: ArchiveGridPeriodType;
  activePeriod: string;
  getHref: ArchiveGridGetHref;
}) {
  const href = getHref(item.href, { item, periodType, activePeriod });
  const active = isActiveArchiveHref(item.href, href, activePeriod);

  return (
    <article className="min-w-0">
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`group flex min-h-32 flex-col rounded-2xl px-4 py-3 transition-[background-color,transform] duration-200 ease-[var(--ease-spring)] hover:-translate-y-0.5 ${
          active ? "bg-primary-container text-on-primary-container" : "bg-surface-container text-on-surface hover:bg-surface-container-high"
        }`}
      >
        <span className={`font-mono text-[0.7rem] uppercase tracking-wider ${active ? "" : "text-on-surface-variant"}`}>{periodType}</span>
        <span className="mt-2 break-words text-[1.05rem] font-extrabold leading-tight">{item.label}</span>
        {item.description && (
          <span className={`mt-2 text-[0.86rem] leading-relaxed ${active ? "text-on-primary-container/85" : "text-on-surface-variant"}`}>
            {item.description}
          </span>
        )}
        {item.count != null && <span className="mt-auto pt-3 font-mono text-[0.75rem] font-semibold tabular-nums">{item.count}</span>}
      </Link>

      {item.childrenLinks && item.childrenLinks.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {item.childrenLinks.map((child) => {
            const childHref = getHref(child.href, { item: child, periodType, activePeriod });
            const childActive = isActiveArchiveHref(child.href, childHref, activePeriod);
            return (
              <Link
                key={child.href}
                href={childHref}
                aria-current={childActive ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 font-mono text-[0.72rem] transition-colors ${
                  childActive
                    ? "bg-primary-container text-on-primary-container"
                    : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                }`}
              >
                {child.label}
                {child.count != null && <span className="ml-1 tabular-nums">{child.count}</span>}
              </Link>
            );
          })}
        </div>
      )}
    </article>
  );
}

function isActiveArchiveHref(rawHref: string, href: string, activePeriod: string): boolean {
  return rawHref === activePeriod || href === activePeriod;
}
