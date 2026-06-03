"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type MiniSearch from "minisearch";
import { useChrome } from "@/lib/i18n/client";
import { fmtStars } from "@/lib/format";
import type { SearchDoc } from "@/lib/contracts";
import type { SearchHit } from "@/lib/search/core";

// Global repo search. The index (search/index.json, ~5k repos) and MiniSearch itself are lazy-
// loaded on first focus — kept out of the initial bundle — then everything runs client-side.
// See docs/V0.2-DESIGN.md §1.

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

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);

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
              {hits.map((h, i) => (
                <li key={h.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                  <Link
                    href={`/${h.full_name}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={reset}
                    className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 transition-colors ${
                      i === active ? "bg-on-surface/8" : "hover:bg-on-surface/5"
                    }`}
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
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-3 font-mono text-[0.76rem] text-on-surface-variant">{loading ? loadingText : emptyText}</p>
          )}
        </div>
      )}
    </div>
  );
}
