"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type MiniSearch from "minisearch";
import { fmtStars } from "@/lib/format";
import type { CompareCurve, SearchDoc } from "@/lib/contracts";
import type { SearchHit } from "@/lib/search/core";
import { MAX_COMPARE, MIN_COMPARE, parseRepos, serializeRepos } from "@/lib/compare/core";
import { loadCompareCurve, type CompareCurveLoadFailure } from "@/lib/compare/load";
import { parseSearchIndexPayload } from "@/lib/search/client";
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

export type CompareClientLabels = {
  modeAbsolute: string;
  modeAlign10k: string;
  pickerPlaceholder: string;
  legendLabel: string;
  empty: string;
  minHint: string;
  limit: string;
  remove: string;
  pickerError: string;
  curveError: string;
  retry: string;
  pickerEmpty: string;
  pickerLoading: string;
  compareModesAria: string;
  starHistoryOverlayAria: string;
};

export function CompareClient({ labels, comparePath = "/compare" }: { labels: CompareClientLabels; comparePath?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const repos = useMemo(() => parseRepos(params?.get("repos")), [params]);

  const [engine, setEngine] = useState<Engine | null>(null);
  const [engineError, setEngineError] = useState(false);
  const [engineRetry, setEngineRetry] = useState(0);
  const [curves, setCurves] = useState<Map<string, CompareCurve>>(new Map());
  const pendingRef = useRef<Set<string>>(new Set());
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const [curveErrors, setCurveErrors] = useState<Map<string, CompareCurveLoadFailure>>(new Map());
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);

  // Load global search index once (same /search-index endpoint used by SearchBox).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setEngineError(false);
        const [core, res] = await Promise.all([
          import("@/lib/search/core"),
          fetch("/search-index", { cache: "force-cache" }),
        ]);
        if (!res.ok) throw new Error(`search-index HTTP ${res.status}`);
        const parsed = parseSearchIndexPayload(await res.json());
        if (!parsed.ok) throw new Error(parsed.message);
        if (cancelled) return;
        const docs = parsed.repos;
        const byFullName = new Map<string, SearchDoc>(docs.map((d) => [d.full_name.toLowerCase(), d]));
        setEngine({ ms: core.createIndex(docs), query: core.queryIndex, byFullName });
      } catch {
        if (!cancelled) setEngineError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [engineRetry]);

  // Fetch curves for selected repos we don't have yet.
  useEffect(() => {
    if (!engine) return;
    const need = repos.filter((name) => {
      const key = name.toLowerCase();
      return !curves.has(key) && !pendingRef.current.has(key) && !curveErrors.has(key);
    });
    if (need.length === 0) return;
    const needKeys = need.map((n) => n.toLowerCase());
    needKeys.forEach((key) => pendingRef.current.add(key));
    setPendingKeys((prev) => new Set([...prev, ...needKeys]));

    let active = true;
    void (async () => {
      try {
        const results = await Promise.all(need.map((name) => loadCompareCurve(name, engine.byFullName.get(name.toLowerCase()))));
        if (!active) return;
        setCurves((prev) => {
          const next = new Map(prev);
          results.forEach((result) => {
            if (result.ok) next.set(result.curve.full_name.toLowerCase(), result.curve);
          });
          return next;
        });
        setCurveErrors((prev) => {
          const next = new Map(prev);
          results.forEach((result) => {
            const key = result.repo.toLowerCase();
            if (result.ok) next.delete(key);
            else next.set(key, result.error);
          });
          return next;
        });
      } catch {
        if (!active) return;
        setCurveErrors((prev) => {
          const next = new Map(prev);
          need.forEach((name) =>
            next.set(name.toLowerCase(), {
              repo: name,
              reason: "request-failed",
              message: `${name} curve request could not complete.`,
            }),
          );
          return next;
        });
      } finally {
        needKeys.forEach((key) => pendingRef.current.delete(key));
        if (active) {
          setPendingKeys((prev) => {
            const next = new Set(prev);
            needKeys.forEach((key) => next.delete(key));
            return next;
          });
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [engine, repos, curves, curveErrors]);

  const orderedCurves = useMemo(
    () => repos.map((n) => curves.get(n.toLowerCase())).filter((c): c is CompareCurve => Boolean(c)),
    [repos, curves],
  );

  const updateRepos = useCallback(
    (next: string[]) => {
      const param = serializeRepos(next);
      const url = param ? `${comparePath}?repos=${encodeURIComponent(param)}` : comparePath;
      router.replace(url, { scroll: false });
    },
    [comparePath, router],
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
      const key = fullName.toLowerCase();
      pendingRef.current.delete(key);
      setPendingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      setCurveErrors((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      updateRepos(repos.filter((n) => n.toLowerCase() !== fullName.toLowerCase()));
    },
    [repos, updateRepos],
  );

  const retryCurve = useCallback((fullName: string) => {
    const key = fullName.toLowerCase();
    setCurveErrors((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

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
        <div className="flex min-h-11 items-center gap-2 rounded-full border border-outline-variant bg-surface px-3 py-2 transition-colors focus-within:border-primary">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-on-surface-variant" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={q}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={labels.pickerPlaceholder}
            aria-label={labels.pickerPlaceholder}
            disabled={!canAdd}
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-transparent font-mono text-[0.85rem] text-on-surface placeholder:text-on-surface-variant disabled:opacity-50"
          />
        </div>
        {!canAdd && <p className="mt-2 font-mono text-[0.75rem] text-on-surface-variant">{labels.limit}</p>}
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
                    className="grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-on-surface/5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[0.82rem]">
                        <span className="text-on-surface-variant">{h.owner}/</span>
                        <span className="font-semibold text-on-surface">{h.full_name.slice(h.owner.length + 1)}</span>
                      </span>
                    </span>
                    <span className="text-readable-gold shrink-0 font-mono text-[0.72rem] tabular-nums">
                      {fmtStars(h.current_stars)} ★
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {engineError && (
          <div role="alert" className="mt-2 rounded-xl border border-outline-variant bg-surface-container-high px-3 py-3 font-mono text-[0.75rem] text-on-surface-variant">
            <p>{labels.pickerError}</p>
            <button type="button" onClick={() => setEngineRetry((value) => value + 1)} className="text-readable-gold mt-2 min-h-8 font-semibold hover:underline">
              {labels.retry}
            </button>
          </div>
        )}
        {q.trim() && hits.length === 0 && !engineError && (
          <p role="status" aria-live="polite" className="mt-2 px-3 font-mono text-[0.75rem] text-on-surface-variant">
            {engine ? labels.pickerEmpty : labels.pickerLoading}
          </p>
        )}
        {repos.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {repos.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => remove(name)}
                  aria-label={`${labels.remove} ${name}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-surface-container-high px-3 py-1 font-mono text-[0.78rem] text-on-surface transition-colors hover:bg-on-surface/10"
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
        {pendingKeys.size > 0 && (
          <p role="status" aria-live="polite" className="mt-3 font-mono text-[0.75rem] text-on-surface-variant">
            {labels.pickerLoading}
          </p>
        )}
        {curveErrors.size > 0 && (
          <div role="alert" className="mt-3 rounded-xl border border-outline-variant bg-surface-container-high px-3 py-3 font-mono text-[0.75rem] text-on-surface-variant">
            <p>{labels.curveError}</p>
            <ul className="mt-2 grid gap-2">
              {[...curveErrors.values()].map((error) => (
                <li key={error.repo} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 truncate" title={error.message}>
                    {error.repo}
                  </span>
                  <button type="button" onClick={() => retryCurve(error.repo)} className="text-readable-gold min-h-8 font-semibold hover:underline">
                    {labels.retry}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-6">
        {orderedCurves.length >= MIN_COMPARE ? (
          <CompareCurveChart
            curves={orderedCurves}
            modeLabels={{ absolute: labels.modeAbsolute, align10k: labels.modeAlign10k }}
            legendAria={labels.legendLabel}
            ariaLabels={{ compareModes: labels.compareModesAria, starHistoryOverlay: labels.starHistoryOverlayAria }}
          />
        ) : (
          <p className="rounded-2xl border border-dashed border-outline-variant px-4 py-8 text-center font-mono text-[0.85rem] text-on-surface-variant">
            {orderedCurves.length === 1 ? labels.minHint : labels.empty}
          </p>
        )}
      </div>
    </div>
  );
}
