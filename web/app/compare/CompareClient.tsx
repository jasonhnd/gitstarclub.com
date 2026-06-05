"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type MiniSearch from "minisearch";
import { useChrome } from "@/lib/i18n/client";
import { fmtStars } from "@/lib/format";
import type { CompareCurve, SearchDoc } from "@/lib/contracts";
import type { SearchHit } from "@/lib/search/core";
import { MAX_COMPARE, MIN_COMPARE, parseRepos, serializeRepos } from "@/lib/compare/core";
import { CompareCurve as CompareCurveChart } from "@/app/_explore/CompareCurve";

// CompareClient (v0.2 §5) — the interactive shell that turns the static /compare page into a
// usable overlay tool. URL is the only state: ?repos=owner/name,owner/name. On mount it lazy-
// loads the global search index (shared with the nav SearchBox) to map full_name → id, then
// fetches each repo's lean curve from /repo-curve?id= in parallel and hands the bunch to
// CompareCurve. Adding/removing rewrites the URL via router.replace (no scroll) so links remain
// shareable. Search core is reused via dynamic import to stay out of the initial bundle.

interface Engine {
  ms: MiniSearch<SearchDoc>;
  query: (ms: MiniSearch<SearchDoc>, q: string, limit?: number) => SearchHit[];
  byFullName: Map<string, SearchDoc>;
}

const PICKER_LIMIT = 6;

export function CompareClient() {
  const router = useRouter();
  const params = useSearchParams();
  const repos = useMemo(() => parseRepos(params?.get("repos")), [params]);

  const [engine, setEngine] = useState<Engine | null>(null);
  const [curves, setCurves] = useState<Map<string, CompareCurve>>(new Map());
  const pendingRef = useRef<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);

  const labelAbs = useChrome("compare.modeAbsolute");
  const labelAlign = useChrome("compare.modeAlign10k");
  const placeholder = useChrome("compare.pickerPlaceholder");
  const legendAria = useChrome("compare.legendLabel");
  const emptyText = useChrome("compare.empty");
  const minHint = useChrome("compare.minHint");
  const limitText = useChrome("compare.limit");
  const removeLabel = useChrome("compare.remove");

  // Load global search index once (same /search-index endpoint used by SearchBox).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [core, res] = await Promise.all([
          import("@/lib/search/core"),
          fetch("/search-index", { cache: "force-cache" }),
        ]);
        const data = (await res.json()) as { repos?: SearchDoc[] };
        if (cancelled) return;
        const docs = data.repos ?? [];
        const byFullName = new Map<string, SearchDoc>(docs.map((d) => [d.full_name.toLowerCase(), d]));
        setEngine({ ms: core.createIndex(docs), query: core.queryIndex, byFullName });
      } catch {
        // best-effort: if the index can't load, the picker stays inert; existing chips remain visible.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch curves for selected repos we don't have yet.
  useEffect(() => {
    if (!engine) return;
    const need = repos.filter((name) => {
      const key = name.toLowerCase();
      return !curves.has(key) && !pendingRef.current.has(key);
    });
    if (need.length === 0) return;
    need.forEach((n) => pendingRef.current.add(n.toLowerCase()));
    void Promise.all(
      need.map(async (name) => {
        const doc = engine.byFullName.get(name.toLowerCase());
        if (!doc) return null;
        const res = await fetch(`/repo-curve?id=${doc.id}`, { cache: "force-cache" });
        if (!res.ok) return null;
        return (await res.json()) as CompareCurve;
      }),
    ).then((results) => {
      setCurves((prev) => {
        const next = new Map(prev);
        results.forEach((r) => {
          if (r) next.set(r.full_name.toLowerCase(), r);
        });
        return next;
      });
      need.forEach((n) => pendingRef.current.delete(n.toLowerCase()));
    });
  }, [engine, repos, curves]);

  const orderedCurves = useMemo(
    () => repos.map((n) => curves.get(n.toLowerCase())).filter((c): c is CompareCurve => Boolean(c)),
    [repos, curves],
  );

  const updateRepos = useCallback(
    (next: string[]) => {
      const param = serializeRepos(next);
      const url = param ? `/compare?repos=${encodeURIComponent(param)}` : "/compare";
      router.replace(url, { scroll: false });
    },
    [router],
  );

  const add = useCallback(
    (fullName: string) => {
      if (repos.length >= MAX_COMPARE) return;
      if (repos.some((n) => n.toLowerCase() === fullName.toLowerCase())) return;
      updateRepos([...repos, fullName]);
      setQ("");
      setHits([]);
    },
    [repos, updateRepos],
  );

  const remove = useCallback(
    (fullName: string) => {
      updateRepos(repos.filter((n) => n.toLowerCase() !== fullName.toLowerCase()));
    },
    [repos, updateRepos],
  );

  const onQueryChange = (v: string) => {
    setQ(v);
    if (!engine || !v.trim()) {
      setHits([]);
      return;
    }
    setHits(engine.query(engine.ms, v, PICKER_LIMIT));
  };

  const canAdd = repos.length < MAX_COMPARE;

  return (
    <div>
      <div className="rounded-2xl border border-outline-variant bg-surface-container p-4">
        <div className="flex items-center gap-2 rounded-full border border-outline-variant bg-surface px-3 py-2 transition-colors focus-within:border-primary">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-on-surface-variant" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={q}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={placeholder}
            disabled={!canAdd}
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-transparent font-mono text-[0.85rem] text-on-surface outline-none placeholder:text-on-surface-variant disabled:opacity-50"
          />
        </div>
        {!canAdd && <p className="mt-2 font-mono text-[0.75rem] text-on-surface-variant">{limitText}</p>}
        {q.trim() && hits.length > 0 && (
          <ul className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-outline-variant bg-surface-container-high">
            {hits.map((h) => {
              const selected = repos.some((n) => n.toLowerCase() === h.full_name.toLowerCase());
              return (
                <li key={h.id}>
                  <button
                    type="button"
                    disabled={selected || !canAdd}
                    onClick={() => add(h.full_name)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-on-surface/5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[0.82rem]">
                        <span className="text-on-surface-variant">{h.owner}/</span>
                        <span className="font-semibold text-on-surface">{h.full_name.slice(h.owner.length + 1)}</span>
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[0.72rem] tabular-nums text-primary-fixed-dim">
                      {fmtStars(h.current_stars)} ★
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {repos.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {repos.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => remove(name)}
                  aria-label={`${removeLabel} ${name}`}
                  className="inline-flex items-center gap-2 rounded-full bg-surface-container-high px-3 py-1 font-mono text-[0.78rem] text-on-surface transition-colors hover:bg-on-surface/10"
                >
                  <span>{name}</span>
                  <span aria-hidden="true" className="text-on-surface-variant">
                    ×
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6">
        {orderedCurves.length >= MIN_COMPARE ? (
          <CompareCurveChart
            curves={orderedCurves}
            modeLabels={{ absolute: labelAbs, align10k: labelAlign }}
            legendAria={legendAria}
          />
        ) : (
          <p className="rounded-2xl border border-dashed border-outline-variant px-4 py-8 text-center font-mono text-[0.85rem] text-on-surface-variant">
            {orderedCurves.length === 1 ? minHint : emptyText}
          </p>
        )}
      </div>
    </div>
  );
}
