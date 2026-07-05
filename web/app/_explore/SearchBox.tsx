"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { MAX_COMPARE } from "@/lib/compare/constants";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locales";
import { localizedPath } from "@/lib/i18n/routing";
import { initialSearchActiveIndex, nextSearchActiveIndex } from "@/lib/search/keyboard";
import { SearchResultsPanel } from "./SearchResultsPanel";
import { useSearchEngine } from "./useSearchEngine";

// Global repo search. The index (search/index.json, ~5k repos) is fetched on first focus;
// MiniSearch indexing and querying run in a Web Worker to keep the main thread responsive.

const LIMIT = 8;

export interface SearchBoxLabels {
  label: string;
  placeholder: string;
  empty: string;
  loading: string;
  error: string;
  retry: string;
  addToCompare: string;
  openCompare: string;
}

export function SearchBox({ labels, locale = DEFAULT_LOCALE }: { labels: SearchBoxLabels; locale?: Locale }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [requestedActive, setRequestedActive] = useState(-1);
  const [compareSet, setCompareSet] = useState<Set<string>>(new Set());
  const search = useSearchEngine({ limit: LIMIT });

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const active =
    requestedActive >= 0 && requestedActive < search.hits.length
      ? requestedActive
      : initialSearchActiveIndex(search.hits.length);

  const reset = useCallback(() => {
    setOpen(false);
    setQ("");
    setRequestedActive(-1);
    search.clear();
  }, [search]);

  const toggleCompare = useCallback((fullName: string) => {
    setCompareSet((prev) => {
      const next = new Set(prev);
      if (next.has(fullName)) next.delete(fullName);
      else if (next.size < MAX_COMPARE) next.add(fullName);
      return next;
    });
  }, []);

  const openCompare = useCallback(() => {
    if (compareSet.size === 0) return;
    const param = encodeURIComponent([...compareSet].join(","));
    router.push(`${localizedPath(locale, "/compare")}?repos=${param}`);
    setCompareSet(new Set());
    reset();
    inputRef.current?.blur();
  }, [compareSet, locale, router, reset]);

  const onChange = (value: string) => {
    setQ(value);
    setOpen(true);
    search.query(value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setRequestedActive((i) => nextSearchActiveIndex(i, search.hits.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setRequestedActive((i) => nextSearchActiveIndex(i, search.hits.length, -1));
    } else if (e.key === "Enter") {
      const hit = search.hits[active];
      if (hit) {
        e.preventDefault();
        router.push(localizedPath(locale, `/${hit.full_name}`));
        inputRef.current?.blur();
        reset();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setRequestedActive(-1);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const showPanel = open && (q.trim().length > 0 || search.loadState === "error");

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
            void search.ensureEngine();
          }}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-20 bg-transparent font-mono text-[0.8rem] text-on-surface placeholder:text-on-surface-variant min-[360px]:w-24 sm:w-44 lg:w-56"
        />
      </div>

      {showPanel && (
        <SearchResultsPanel
          listId={listId}
          labels={labels}
          locale={locale}
          hits={search.hits}
          active={active}
          loadState={search.loadState}
          compareSet={compareSet}
          onActive={setRequestedActive}
          onReset={reset}
          onToggleCompare={toggleCompare}
          onRetry={() => search.retry(q)}
          onOpenCompare={openCompare}
        />
      )}
    </div>
  );
}
