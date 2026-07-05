import Link from "next/link";
import { fmtStars } from "@/lib/format";
import { MAX_COMPARE } from "@/lib/compare/constants";
import type { Locale } from "@/lib/i18n/locales";
import { localizedPath } from "@/lib/i18n/routing";
import type { SearchHit } from "@/lib/search/core";
import type { SearchLoadState } from "@/lib/search/client";

export interface SearchResultsPanelLabels {
  label: string;
  empty: string;
  loading: string;
  error: string;
  retry: string;
  addToCompare: string;
  openCompare: string;
}

export function SearchResultsPanel({
  listId,
  labels,
  locale,
  hits,
  active,
  loadState,
  compareSet,
  onActive,
  onReset,
  onToggleCompare,
  onRetry,
  onOpenCompare,
}: {
  listId: string;
  labels: SearchResultsPanelLabels;
  locale: Locale;
  hits: SearchHit[];
  active: number;
  loadState: SearchLoadState;
  compareSet: Set<string>;
  onActive: (index: number) => void;
  onReset: () => void;
  onToggleCompare: (fullName: string) => void;
  onRetry: () => void;
  onOpenCompare: () => void;
}) {
  return (
    <div className="absolute right-0 z-30 mt-2 w-[min(24rem,92vw)] overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-high shadow-[var(--elev-2)]">
      {loadState === "error" ? (
        <div role="status" aria-live="polite" className="px-3 py-3 font-mono text-[0.76rem] text-on-surface-variant">
          <p>{labels.error}</p>
          <button type="button" onClick={onRetry} className="text-readable-gold mt-2 min-h-8 font-semibold hover:underline">
            {labels.retry}
          </button>
        </div>
      ) : hits.length > 0 ? (
        <ul id={listId} role="listbox" aria-label={labels.label} className="max-h-[70vh] overflow-y-auto py-1">
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
                    onMouseEnter={() => onActive(i)}
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
                    aria-label={`${labels.addToCompare}: ${h.full_name}`}
                    title={labels.addToCompare}
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
      ) : (
        <p role="status" aria-live="polite" className="px-3 py-3 font-mono text-[0.76rem] text-on-surface-variant">
          {loadState === "loading" ? labels.loading : labels.empty}
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
            {labels.openCompare} →
          </button>
        </div>
      )}
    </div>
  );
}
