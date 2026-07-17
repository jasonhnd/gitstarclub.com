import Link from "next/link";
import { fmtStars } from "@/lib/format";
import type { SearchHit } from "@/lib/search/core";
import { MAX_COMPARE } from "@/lib/compare/constants";
import type { Locale } from "@/lib/i18n/locales";
import { localizedPath } from "@/lib/i18n/routing";
import { Star } from "../Star";
import type { SearchBoxLabels } from "./types";

export function SearchPanel({
  active,
  compareSet,
  hits,
  labels,
  listId,
  loading,
  locale,
  onActiveChange,
  onOpenCompare,
  onReset,
  onRetry,
  onToggleCompare,
  searchFailed,
}: {
  active: number;
  compareSet: Set<string>;
  hits: SearchHit[];
  labels: SearchBoxLabels;
  listId: string;
  loading: boolean;
  locale: Locale;
  onActiveChange: (index: number) => void;
  onOpenCompare: () => void;
  onReset: () => void;
  onRetry: () => void;
  onToggleCompare: (fullName: string) => void;
  searchFailed: boolean;
}) {
  return (
    <div className="absolute right-0 z-30 mt-2 w-[min(24rem,92vw)] overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-high shadow-[var(--elev-2)]">
      {searchFailed ? (
        <SearchError labels={labels} onRetry={onRetry} />
      ) : hits.length > 0 ? (
        <SearchResultList
          active={active}
          compareSet={compareSet}
          hits={hits}
          labels={labels}
          listId={listId}
          locale={locale}
          onActiveChange={onActiveChange}
          onReset={onReset}
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
  active,
  compareSet,
  hits,
  labels,
  listId,
  locale,
  onActiveChange,
  onReset,
  onToggleCompare,
}: {
  active: number;
  compareSet: Set<string>;
  hits: SearchHit[];
  labels: SearchBoxLabels;
  listId: string;
  locale: Locale;
  onActiveChange: (index: number) => void;
  onReset: () => void;
  onToggleCompare: (fullName: string) => void;
}) {
  return (
    <ul id={listId} role="listbox" aria-label={labels.label} className="max-h-[70vh] overflow-y-auto py-1">
      {hits.map((hit, index) => (
        <SearchResultRow
          key={hit.id}
          active={index === active}
          compareDisabled={!compareSet.has(hit.full_name) && compareSet.size >= MAX_COMPARE}
          hit={hit}
          index={index}
          inCompare={compareSet.has(hit.full_name)}
          label={labels.addToCompare}
          listId={listId}
          locale={locale}
          onActiveChange={onActiveChange}
          onReset={onReset}
          onToggleCompare={onToggleCompare}
        />
      ))}
    </ul>
  );
}

function SearchResultRow({
  active,
  compareDisabled,
  hit,
  index,
  inCompare,
  label,
  listId,
  locale,
  onActiveChange,
  onReset,
  onToggleCompare,
}: {
  active: boolean;
  compareDisabled: boolean;
  hit: SearchHit;
  index: number;
  inCompare: boolean;
  label: string;
  listId: string;
  locale: Locale;
  onActiveChange: (index: number) => void;
  onReset: () => void;
  onToggleCompare: (fullName: string) => void;
}) {
  return (
    <li id={`${listId}-${index}`} role="option" aria-selected={active}>
      <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-stretch transition-colors ${active ? "bg-on-surface/8" : "hover:bg-on-surface/5"}`}>
        <Link
          href={localizedPath(locale, `/${hit.full_name}`)}
          onMouseEnter={() => onActiveChange(index)}
          onClick={onReset}
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
          onClick={() => onToggleCompare(hit.full_name)}
          disabled={compareDisabled}
          aria-pressed={inCompare}
          aria-label={`${label}: ${hit.full_name}`}
          title={label}
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
