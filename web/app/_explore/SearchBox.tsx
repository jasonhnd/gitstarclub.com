"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type MiniSearch from "minisearch";
import { useChrome } from "@/lib/i18n/client";
import { fmtStars } from "@/lib/format";
import type { SearchDoc } from "@/lib/contracts";
import type { SearchHit } from "@/lib/search/core";
import { MAX_COMPARE } from "@/lib/compare/core";

// Global repo search. The index (search/index.json, ~5k repos) and MiniSearch itself are lazy-
// loaded on first focus — kept out of the initial bundle — then everything runs client-side.
// Each result row also has a "+ compare" toggle (v0.2 §5): selections accumulate in a small set
// and a footer CTA jumps to /compare?repos=… with everything chosen. Capped at MAX_COMPARE.
// See docs/FRONTEND.md (search + compare surfaces).

const LIMIT = 8;

interface Engine {
  ms: MiniSearch<SearchDoc>;
  query: (ms: MiniSearch<SearchDoc>, q: string, limit?: number) => SearchHit[];
}

export function SearchBox() {
  const router = useRouter();
  const label = useChrome("search.label");
  const placeholder = useChrome("search.placeholder");
  const emptyText = useChrome("search.empty");
  const loadingText = useChrome("search.loading");
  const addToCompareLabel = useChrome("compare.addToCompare");
  const openCompareLabel = useChrome("compare.openCompare");

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [compareSet, setCompareSet] = useState<Set<string>>(new Set());

  const engineRef = useRef<Engine | null>(null);
  const loadingRef = useRef(false);
  const pendingRef = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const listId = useId();

  const runQuery = useCallback((value: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = engine.query(engine.ms, value, LIMIT);
    setHits(next);
    setActive(next.length > 0 ? 0 : -1);
  }, []);

  const ensureEngine = useCallback(async () => {
    if (engineRef.current || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const [core, res] = await Promise.all([
        import("@/lib/search/core"),
        fetch("/search-index", { cache: "force-cache" }),
      ]);
      const data = (await res.json()) as { repos?: SearchDoc[] };
      engineRef.current = { ms: core.createIndex(data.repos ?? []), query: core.queryIndex };
      if (pendingRef.current != null) {
        runQuery(pendingRef.current);
        pendingRef.current = null;
      }
    } catch {
      // best-effort: if the index can't load, search stays inert (no matches), nothing breaks.
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [runQuery]);

  const reset = useCallback(() => {
    setOpen(false);
    setQ("");
    setHits([]);
    setActive(-1);
  }, []);

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
    router.push(`/compare?repos=${param}`);
    setCompareSet(new Set());
    reset();
    inputRef.current?.blur();
  }, [compareSet, router, reset]);

  const onChange = (value: string) => {
    setQ(value);
    setOpen(true);
    if (!engineRef.current) {
      pendingRef.current = value;
      void ensureEngine();
      return;
    }
    runQuery(value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const hit = hits[active];
      if (hit) {
        e.preventDefault();
        router.push(`/${hit.full_name}`);
        inputRef.current?.blur();
        reset();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
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

  const showPanel = open && q.trim().length > 0;

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-3 py-1.5 transition-colors focus-within:border-primary focus-within:bg-surface">
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
          aria-label={label}
          aria-activedescendant={showPanel && active >= 0 ? `${listId}-${active}` : undefined}
          enterKeyHint="go"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={q}
          onFocus={() => {
            setOpen(true);
            void ensureEngine();
          }}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-32 bg-transparent font-mono text-[0.8rem] text-on-surface outline-none placeholder:text-on-surface-variant sm:w-44 lg:w-56"
        />
      </div>

      {showPanel && (
        <div className="absolute right-0 z-30 mt-2 w-[min(24rem,92vw)] overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-high shadow-xl">
          {hits.length > 0 ? (
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
                        href={`/${h.full_name}`}
                        onMouseEnter={() => setActive(i)}
                        onClick={reset}
                        className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2"
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
                          <span className="tabular-nums text-primary-fixed-dim">{fmtStars(h.current_stars)} ★</span>
                        </span>
                      </Link>
                      <button
                        type="button"
                        onClick={() => toggleCompare(h.full_name)}
                        disabled={compareDisabled}
                        aria-pressed={inCompare}
                        aria-label={`${addToCompareLabel}: ${h.full_name}`}
                        title={addToCompareLabel}
                        className={`flex w-9 items-center justify-center font-mono text-[0.95rem] transition-colors ${
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
            <p className="px-3 py-3 font-mono text-[0.76rem] text-on-surface-variant">{loading ? loadingText : emptyText}</p>
          )}
          {compareSet.size > 0 && (
            <div className="flex items-center justify-between gap-3 border-t border-outline-variant px-3 py-2">
              <span className="font-mono text-[0.72rem] text-on-surface-variant">
                {compareSet.size}/{MAX_COMPARE}
              </span>
              <button
                type="button"
                onClick={openCompare}
                className="rounded-full bg-primary-container px-3 py-1 font-mono text-[0.75rem] font-semibold text-on-primary-container transition-colors hover:brightness-110"
              >
                {openCompareLabel} →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
