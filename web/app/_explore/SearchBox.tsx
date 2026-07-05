"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locales";
import { localizedPath } from "@/lib/i18n/routing";
import { SearchResultsPanel } from "./search/SearchResults";
import { useCompareSelection } from "./search/useCompareSelection";
import { useSearchEngine } from "./search/useSearchEngine";
import { useSearchKeyboardNavigation } from "./search/useSearchKeyboardNavigation";

const LIMIT = 8;

export interface SearchBoxLabels {
  label: string;
  placeholder: string;
  empty: string;
  loading: string;
  addToCompare: string;
  openCompare: string;
}

export function SearchBox({ labels, locale = DEFAULT_LOCALE }: { labels: SearchBoxLabels; locale?: Locale }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const handleSearchResults = useCallback((nextHits: { length: number }) => {
    setActive(nextHits.length > 0 ? 0 : -1);
  }, []);
  const { hits, loading, ensureEngine, query, clearHits } = useSearchEngine({ limit: LIMIT, onResults: handleSearchResults });
  const { compareSet, toggleCompare, clearCompare, compareParam } = useCompareSelection();

  const reset = useCallback(() => {
    setOpen(false);
    setQ("");
    clearHits();
    setActive(-1);
  }, [clearHits]);

  const openCompare = useCallback(() => {
    if (compareSet.size === 0) return;
    router.push(`${localizedPath(locale, "/compare")}?repos=${compareParam}`);
    clearCompare();
    reset();
    inputRef.current?.blur();
  }, [clearCompare, compareParam, compareSet.size, locale, reset, router]);

  const onKeyDown = useSearchKeyboardNavigation({
    active,
    hits,
    setActive,
    onClose: () => setOpen(false),
    onOpen: () => setOpen(true),
    onCommit: (hit) => {
      router.push(localizedPath(locale, `/${hit.full_name}`));
      inputRef.current?.blur();
      reset();
    },
  });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const showPanel = open && q.trim().length > 0;

  return (
    <div ref={rootRef} className="relative min-w-0">
      <div className="flex min-h-11 items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-3 py-1.5 transition-colors focus-within:border-primary focus-within:bg-surface">
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-on-surface-variant" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={labels.label}
          aria-activedescendant={showPanel && active >= 0 ? `${listId}-${active}` : undefined}
          enterKeyHint="go"
          autoComplete="off"
          spellCheck={false}
          placeholder={labels.placeholder}
          value={q}
          onFocus={() => {
            setOpen(true);
            void ensureEngine();
          }}
          onChange={(e) => {
            const value = e.target.value;
            setQ(value);
            setOpen(true);
            query(value);
          }}
          onKeyDown={onKeyDown}
          className="w-20 bg-transparent font-mono text-[0.8rem] text-on-surface placeholder:text-on-surface-variant min-[360px]:w-24 sm:w-44 lg:w-56"
        />
      </div>

      {showPanel && (
        <SearchResultsPanel
          active={active}
          addToCompareLabel={labels.addToCompare}
          compareSet={compareSet}
          emptyText={labels.empty}
          hits={hits}
          label={labels.label}
          listId={listId}
          loading={loading}
          loadingText={labels.loading}
          locale={locale}
          onActivate={setActive}
          onOpenCompare={openCompare}
          onReset={reset}
          onToggleCompare={toggleCompare}
          openCompareLabel={labels.openCompare}
        />
      )}
    </div>
  );
}
