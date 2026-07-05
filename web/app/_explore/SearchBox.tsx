"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_COMPARE } from "@/lib/compare/constants";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locales";
import { localizedPath } from "@/lib/i18n/routing";
import { SearchPanel } from "./search-box/SearchPanel";
import type { SearchBoxLabels } from "./search-box/types";
import { useCompareSelection } from "./search-box/useCompareSelection";
import { useSearchEngine } from "./search-box/useSearchEngine";
import { useSearchKeyboardNavigation } from "./search-box/useSearchKeyboardNavigation";

export type { SearchBoxLabels } from "./search-box/types";

// Global repo search. The index is fetched on first focus; MiniSearch indexing and querying
// run in a Web Worker. Result rendering, keyboard navigation, and compare selection are kept
// in small modules so the client shell only coordinates state and navigation.

const LIMIT = 8;

export function SearchBox({ labels, locale = DEFAULT_LOCALE }: { labels: SearchBoxLabels; locale?: Locale }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const { ensureEngine, hits, loadState, query, resetHits } = useSearchEngine({ limit: LIMIT });
  const { clearCompare, compareSet, toggleCompare } = useCompareSelection(MAX_COMPARE);

  const resetShell = useCallback(() => {
    setOpen(false);
    setQ("");
    resetHits();
  }, [resetHits]);

  const commitHit = useCallback(
    (index: number) => {
      const hit = hits[index];
      if (!hit) return;
      router.push(localizedPath(locale, `/${hit.full_name}`));
      inputRef.current?.blur();
      resetShell();
    },
    [hits, locale, resetShell, router],
  );

  const { active, onKeyDown, resetActive, setActive } = useSearchKeyboardNavigation({
    itemCount: hits.length,
    onCommit: commitHit,
    onEscape: () => setOpen(false),
    onOpen: () => setOpen(true),
  });

  const reset = useCallback(() => {
    resetShell();
    resetActive();
  }, [resetActive, resetShell]);

  useEffect(() => {
    setActive(hits.length > 0 ? 0 : -1);
  }, [hits, setActive]);

  const retrySearch = useCallback(() => {
    setOpen(true);
    void ensureEngine({ force: true, query: q });
  }, [ensureEngine, q]);

  const openCompare = useCallback(() => {
    if (compareSet.size === 0) return;
    const param = encodeURIComponent([...compareSet].join(","));
    router.push(`${localizedPath(locale, "/compare")}?repos=${param}`);
    clearCompare();
    reset();
    inputRef.current?.blur();
  }, [clearCompare, compareSet, locale, reset, router]);

  const onChange = useCallback(
    (value: string) => {
      setQ(value);
      setOpen(true);
      if (!query(value) && loadState !== "error") void ensureEngine();
    },
    [ensureEngine, loadState, query],
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const hasQuery = q.trim().length > 0;
  const loading = loadState === "loading";
  const searchFailed = loadState === "error";
  const showPanel = open && (hasQuery || searchFailed);

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
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-20 bg-transparent font-mono text-[0.8rem] text-on-surface placeholder:text-on-surface-variant min-[360px]:w-24 sm:w-44 lg:w-56"
        />
      </div>

      {showPanel && (
        <SearchPanel
          active={active}
          compareSet={compareSet}
          hits={hits}
          labels={labels}
          listId={listId}
          loading={loading}
          locale={locale}
          onActiveChange={setActive}
          onOpenCompare={openCompare}
          onReset={reset}
          onRetry={retrySearch}
          onToggleCompare={toggleCompare}
          searchFailed={searchFailed}
        />
      )}
    </div>
  );
}
