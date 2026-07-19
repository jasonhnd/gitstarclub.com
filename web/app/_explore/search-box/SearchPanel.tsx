import Link from "next/link";
import type { KeyboardEvent } from "react";
import { fmtStars } from "@/lib/format";
import type { SearchHit } from "@/lib/search/core";
import { MAX_COMPARE } from "@/lib/compare/constants";
import type { Locale } from "@/lib/i18n/locales";
import { localizedPath } from "@/lib/i18n/routing";
import { Star } from "../Star";
import type { SearchBoxLabels } from "./types";

export function SearchPanel({
  compareSet,
  hits,
  labels,
  loading,
  locale,
  onOpenCompare,
  onReset,
  onResultKeyDown,
  onRetry,
  onToggleCompare,
  panelId,
  searchFailed,
}: {
  compareSet: Set<string>;
  hits: SearchHit[];
  labels: SearchBoxLabels;
  loading: boolean;
  locale: Locale;
  onOpenCompare: () => void;
  onReset: () => void;
  onResultKeyDown: (event: KeyboardEvent<HTMLElement>, index: number) => void;
  onRetry: () => void;
  onToggleCompare: (fullName: string) => void;
  panelId: string;
  searchFailed: boolean;
}) {
  return (
    <div
      id={panelId}
      role="dialog"
      aria-label={labels.label}
      className="absolute right-0 z-30 mt-2 w-[min(24rem,92vw)] overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-high shadow-[var(--elev-2)]"
    >
      {searchFailed ? (
        <SearchError labels={labels} onRetry={onRetry} />
      ) : hits.length > 0 ? (
        <SearchResultList
          compareSet={compareSet}
          hits={hits}
          labels={labels}
          locale={locale}
          onReset={onReset}
          onResultKeyDown={onResultKeyDown}
          onToggleCompare={onToggleCompare}
        />
      ) : (
        <SearchEmpty loading={loading} labels={labels} />
      )}
      {compareSet.size > 0 && <SearchCompareFooter count={compareSet.size} label={labels.openCompare} onOpenCompare={onOpenCompare} />}
    </div>
  );
}

function SearchError({ labels, onRetry }: { labels: SearchBoxLabels; onRetry: () => void }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2 px-3 py-3">
      <p className="font-mono text-[0.76rem] text-on-surface-variant">{labels.error}</p>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-9 rounded-full bg-primary-container px-3 py-1 font-mono text-[0.72rem] font-semibold text-on-primary-container transition-colors hover:brightness-110"
      >
        {labels.retry}
      </button>
    </div>
  );
}

function SearchEmpty({ loading, labels }: { loading: boolean; labels: SearchBoxLabels }) {
  return (
    <p role="status" aria-live="polite" className="px-3 py-3 font-mono text-[0.76rem] text-on-surface-variant">
      {loading ? labels.loading : labels.empty}
    </p>
  );
}

function SearchResultList({
  compareSet,
  hits,
  labels,
  locale,
  onReset,
  onResultKeyDown,
  onToggleCompare,
}: {
  compareSet: Set<string>;
  hits: SearchHit[];
  labels: SearchBoxLabels;
  locale: Locale;
  onReset: () => void;
  onResultKeyDown: (event: KeyboardEvent<HTMLElement>, index: number) => void;
  onToggleCompare: (fullName: string) => void;
}) {
  return (
    <ul aria-label={labels.label} className="max-h-[70vh] overflow-y-auto py-1">
      {hits.map((hit, index) => (
        <SearchResultRow
          key={hit.id}
          compareDisabled={!compareSet.has(hit.full_name) && compareSet.size >= MAX_COMPARE}
          hit={hit}
          index={index}
          inCompare={compareSet.has(hit.full_name)}
          labels={labels}
          locale={locale}
          onReset={onReset}
          onResultKeyDown={onResultKeyDown}
          onToggleCompare={onToggleCompare}
        />
      ))}
    </ul>
  );
}

function SearchResultRow({
  compareDisabled,
  hit,
  index,
  inCompare,
  labels,
  locale,
  onReset,
  onResultKeyDown,
  onToggleCompare,
}: {
  compareDisabled: boolean;
  hit: SearchHit;
  index: number;
  inCompare: boolean;
  labels: SearchBoxLabels;
  locale: Locale;
  onReset: () => void;
  onResultKeyDown: (event: KeyboardEvent<HTMLElement>, index: number) => void;
  onToggleCompare: (fullName: string) => void;
}) {
  const compareLabel = inCompare ? labels.removeFromCompare : labels.addToCompare;

  return (
    <li>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-stretch transition-colors hover:bg-on-surface/5 focus-within:bg-on-surface/8">
        <Link
          href={localizedPath(locale, `/${hit.full_name}`)}
          data-search-result-link
          data-search-result-index={index}
          onClick={onReset}
          onKeyDown={(event) => onResultKeyDown(event, index)}
          className="grid min-h-11 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5"
        >
          <span className="min-w-0">
            <span className="block truncate font-mono text-[0.82rem]">
              <span className="text-on-surface-variant">{hit.owner}/</span>
              <span className="font-semibold text-on-surface">{hit.full_name.slice(hit.owner.length + 1)}</span>
            </span>
            {hit.description && <span className="mt-0.5 block truncate text-[0.72rem] text-on-surface-variant">{hit.description}</span>}
          </span>
          <span className="flex shrink-0 items-center gap-2 font-mono text-[0.72rem] text-on-surface-variant">
            {hit.language && <span className="hidden sm:inline">{hit.language}</span>}
            <span className="tabular-nums">
              {fmtStars(hit.current_stars, locale)} <Star />
            </span>
          </span>
        </Link>
        <button
          type="button"
          data-search-result-index={index}
          onClick={() => onToggleCompare(hit.full_name)}
          onKeyDown={(event) => onResultKeyDown(event, index)}
          disabled={compareDisabled}
          aria-pressed={inCompare}
          aria-label={`${compareLabel}: ${hit.full_name}`}
          title={compareLabel}
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
}

function SearchCompareFooter({ count, label, onOpenCompare }: { count: number; label: string; onOpenCompare: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-outline-variant px-3 py-2">
      <span className="font-mono text-[0.72rem] text-on-surface-variant">
        {count}/{MAX_COMPARE}
      </span>
      <button
        type="button"
        onClick={onOpenCompare}
        className="min-h-11 rounded-full bg-primary-container px-3 py-1 font-mono text-[0.75rem] font-semibold text-on-primary-container transition-colors hover:brightness-110"
      >
        {label} →
      </button>
    </div>
  );
}
