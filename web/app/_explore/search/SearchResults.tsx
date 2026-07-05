"use client";

import Link from "next/link";
import { MAX_COMPARE } from "@/lib/compare/constants";
import { fmtStars } from "@/lib/format";
import type { Locale } from "@/lib/i18n/locales";
import { localizedPath } from "@/lib/i18n/routing";
import type { SearchHit } from "@/lib/search/core";

export function SearchResultsPanel({
  active,
  addToCompareLabel,
  compareSet,
  emptyText,
  hits,
  label,
  listId,
  loading,
  loadingText,
  locale,
  onActivate,
  onOpenCompare,
  onReset,
  onToggleCompare,
  openCompareLabel,
}: {
  active: number;
  addToCompareLabel: string;
  compareSet: ReadonlySet<string>;
  emptyText: string;
  hits: readonly SearchHit[];
  label: string;
  listId: string;
  loading: boolean;
  loadingText: string;
  locale: Locale;
  onActivate: (index: number) => void;
  onOpenCompare: () => void;
  onReset: () => void;
  onToggleCompare: (fullName: string) => void;
  openCompareLabel: string;
}) {
  return (
    <div className="absolute right-0 z-30 mt-2 w-[min(24rem,92vw)] overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-high shadow-[var(--elev-2)]">
      {hits.length > 0 ? (
        <SearchResultList
          active={active}
          addToCompareLabel={addToCompareLabel}
          compareSet={compareSet}
          hits={hits}
          label={label}
          listId={listId}
          locale={locale}
          onActivate={onActivate}
          onReset={onReset}
          onToggleCompare={onToggleCompare}
        />
      ) : (
        <p role="status" aria-live="polite" className="px-3 py-3 font-mono text-[0.76rem] text-on-surface-variant">
          {loading ? loadingText : emptyText}
        </p>
      )}
      {compareSet.size > 0 && (
        <div className="flex items-center justify-between gap-3 border-t border-outline-variant px-3 py-2">
          <span className="font-mono text-[0.72rem] text-on-surface-variant">
            {compareSet.size}/{MAX_COMPARE}
          </span>
          <button
            type="button"
            onClick={onOpenCompare}
            className="min-h-11 rounded-full bg-primary-container px-3 py-1 font-mono text-[0.75rem] font-semibold text-on-primary-container transition-colors hover:brightness-110"
          >
            {openCompareLabel} →
          </button>
        </div>
      )}
    </div>
  );
}

function SearchResultList({
  active,
  addToCompareLabel,
  compareSet,
  hits,
  label,
  listId,
  locale,
  onActivate,
  onReset,
  onToggleCompare,
}: {
  active: number;
  addToCompareLabel: string;
  compareSet: ReadonlySet<string>;
  hits: readonly SearchHit[];
  label: string;
  listId: string;
  locale: Locale;
  onActivate: (index: number) => void;
  onReset: () => void;
  onToggleCompare: (fullName: string) => void;
}) {
  return (
    <ul id={listId} role="listbox" aria-label={label} className="max-h-[70vh] overflow-y-auto py-1">
      {hits.map((h, i) => {
        const inCompare = compareSet.has(h.full_name);
        const compareDisabled = !inCompare && compareSet.size >= MAX_COMPARE;
        return (
          <li key={h.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
            <div
              className={`grid grid-cols-[minmax(0,1fr)_auto] items-stretch transition-colors ${
                i === active ? "bg-on-surface/8" : "hover:bg-on-surface/5"
              }`}
            >
              <Link
                href={localizedPath(locale, `/${h.full_name}`)}
                onMouseEnter={() => onActivate(i)}
                onClick={onReset}
                className="grid min-h-11 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[0.82rem]">
                    <span className="text-on-surface-variant">{h.owner}/</span>
                    <span className="font-semibold text-on-surface">{h.full_name.slice(h.owner.length + 1)}</span>
                  </span>
                  {h.description && (
                    <span className="mt-0.5 block truncate text-[0.72rem] text-on-surface-variant">{h.description}</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2 font-mono text-[0.72rem] text-on-surface-variant">
                  {h.language && <span className="hidden sm:inline">{h.language}</span>}
                  <span className="text-readable-gold tabular-nums">{fmtStars(h.current_stars)} ★</span>
                </span>
              </Link>
              <button
                type="button"
                onClick={() => onToggleCompare(h.full_name)}
                disabled={compareDisabled}
                aria-pressed={inCompare}
                aria-label={`${addToCompareLabel}: ${h.full_name}`}
                title={addToCompareLabel}
                className={`flex w-11 items-center justify-center font-mono text-[0.95rem] transition-colors ${
                  inCompare
                    ? "bg-primary-container text-on-primary-container"
                    : "text-on-surface-variant hover:bg-on-surface/10 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                }`}
              >
                {inCompare ? "✓" : "+"}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
