"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fmtStars } from "@/lib/format";
import type { SearchDoc } from "@/lib/contracts";
import type { SearchHit } from "@/lib/search/core";
import { MAX_COMPARE } from "@/lib/compare/constants";

// Global repo search. The index (search/index.json, ~5k repos) is fetched on first focus;
// MiniSearch indexing and querying run in a Web Worker to keep the main thread responsive.
// Each result row also has a "+ compare" toggle (v0.2 §5): selections accumulate in a small set
// and a footer CTA jumps to /compare?repos=… with everything chosen. Capped at MAX_COMPARE.
// See docs/FRONTEND.md (search + compare surfaces).

const LIMIT = 8;

type WorkerMessage = { type: "ready" } | { type: "results"; id: number; hits: SearchHit[] } | { type: "error"; id?: number };

export interface SearchBoxLabels {
  label: string;
  placeholder: string;
  empty: string;
  loading: string;
  addToCompare: string;
  openCompare: string;
}

export function SearchBox({ labels }: { labels: SearchBoxLabels }) {
  const router = useRouter();
  const label = labels.label;
  const placeholder = labels.placeholder;
  const emptyText = labels.empty;
  const loadingText = labels.loading;
  const addToCompareLabel = labels.addToCompare;
  const openCompareLabel = labels.openCompare;

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [compareSet, setCompareSet] = useState<Set<string>>(new Set());

  const workerRef = useRef<Worker | null>(null);
  const readyRef = useRef(false);
  const loadingRef = useRef(false);
  const pendingRef = useRef<string | null>(null);
  const requestRef = useRef(0);
  const activeRequestRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const listId = useId();

  const runQuery = useCallback((value: string) => {
    const worker = workerRef.current;
    if (!worker || !readyRef.current) {
      pendingRef.current = value;
      return;
    }
    const id = ++requestRef.current;
    activeRequestRef.current = id;
    worker.postMessage({ type: "query", id, q: value, limit: LIMIT });
  }, []);

  const ensureEngine = useCallback(async () => {
    if (workerRef.current || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const res = await fetch("/search-index", { cache: "force-cache" });
      const data = (await res.json()) as { repos?: SearchDoc[] };
      const worker = new Worker(new URL("./search-worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.type === "ready") {
          readyRef.current = true;
          loadingRef.current = false;
          setLoading(false);
          if (pendingRef.current != null) {
            const pending = pendingRef.current;
            pendingRef.current = null;
            runQuery(pending);
          }
          return;
        }
        if (message.type === "results" && message.id === activeRequestRef.current) {
          setHits(message.hits);
          setActive(message.hits.length > 0 ? 0 : -1);
          return;
        }
        if (message.type === "error") {
          setHits([]);
          setActive(-1);
          if (message.id === undefined || !readyRef.current) {
            worker.terminate();
            workerRef.current = null;
            loadingRef.current = false;
            readyRef.current = false;
            setLoading(false);
          }
        }
      };
      worker.onerror = () => {
        worker.terminate();
        workerRef.current = null;
        loadingRef.current = false;
        readyRef.current = false;
        setLoading(false);
      };
      worker.postMessage({ type: "init", repos: data.repos ?? [] });
    } catch {
      // best-effort: if the index can't load, search stays inert (no matches), nothing breaks.
      loadingRef.current = false;
      readyRef.current = false;
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
    if (!readyRef.current) {
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
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      readyRef.current = false;
    };
  }, []);

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
          className="w-20 bg-transparent font-mono text-[0.8rem] text-on-surface placeholder:text-on-surface-variant min-[360px]:w-24 sm:w-44 lg:w-56"
        />
      </div>

      {showPanel && (
        <div className="absolute right-0 z-30 mt-2 w-[min(24rem,92vw)] overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-high shadow-[var(--elev-2)]">
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
                        onClick={() => toggleCompare(h.full_name)}
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
                onClick={openCompare}
                className="min-h-11 rounded-full bg-primary-container px-3 py-1 font-mono text-[0.75rem] font-semibold text-on-primary-container transition-colors hover:brightness-110"
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
