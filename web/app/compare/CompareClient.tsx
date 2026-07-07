"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type MiniSearch from "minisearch";
import { fmtStars } from "@/lib/format";
import type { CompareCurve, SearchDoc } from "@/lib/contracts";
import type { SearchHit } from "@/lib/search/core";
import { fetchRepoCurve } from "@/lib/compare/curve-fetch";
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

export type CompareClientLabels = {
  modeAbsolute: string;
  modeAlign10k: string;
  pickerPlaceholder: string;
  legendLabel: string;
  empty: string;
  minHint: string;
  limit: string;
  remove: string;
  pickerEmpty: string;
  pickerLoading: string;
  pickerLoadError: string;
  loadError: string;
  retry: string;
  compareModesAria: string;
  starHistoryOverlayAria: string;
  currentStars: string;
  tenKMonths: string;
  repoCurveSource: string;
};

function formatRepoLabel(template: string, repo: string): string {
  return template.replace("{repo}", repo);
}

function formatCrossed10k(value: string | null | undefined): string {
  return value ? value.slice(0, 7) : "-";
}

function logCompareClientError(message: string, error: unknown) {
  if (process.env.NODE_ENV !== "production") {
    console.error(message, error);
  }
}

export function CompareClient({ labels, comparePath = "/compare" }: { labels: CompareClientLabels; comparePath?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const repos = useMemo(() => parseRepos(params?.get("repos")), [params]);

  const [engine, setEngine] = useState<Engine | null>(null);
  const [curves, setCurves] = useState<Map<string, CompareCurve>>(new Map());
  const [curveErrors, setCurveErrors] = useState<Map<string, string>>(new Map());
  const pendingRef = useRef<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [pickerError, setPickerError] = useState(false);

  // Load global search index once (same /search-index endpoint used by SearchBox).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [core, res] = await Promise.all([
          import("@/lib/search/core"),
          fetch("/search-index", { cache: "force-cache" }),
        ]);
        if (!res.ok) throw new Error(`search index request failed: ${res.status}`);
        const data = (await res.json()) as { repos?: SearchDoc[] };
        if (cancelled) return;
        const docs = data.repos ?? [];
        const byFullName = new Map<string, SearchDoc>(docs.map((d) => [d.full_name.toLowerCase(), d]));
        setEngine({ ms: core.createIndex(docs), query: core.queryIndex, byFullName });
        setPickerError(false);
      } catch (error) {
        logCompareClientError("[compare] failed to load search index", error);
        if (!cancelled) setPickerError(true);
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
      return !curves.has(key) && !curveErrors.has(key) && !pendingRef.current.has(key);
    });
    if (need.length === 0) return;
    need.forEach((n) => pendingRef.current.add(n.toLowerCase()));
    let cancelled = false;

    void (async () => {
      try {
        const results = await Promise.all(
          need.map(async (name) => {
            const key = name.toLowerCase();
            const doc = engine.byFullName.get(key);
            if (!doc) return { ok: false as const, name, key, reason: "missing-repo" };
            return fetchRepoCurve(name, doc.id);
          }),
        );
        if (cancelled) return;

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
            if (result.ok) {
              next.delete(result.key);
              return;
            }
            logCompareClientError(`[compare] failed to load curve for ${result.name}`, result);
            next.set(result.key, result.name);
          });
          return next;
        });
      } catch (error) {
        logCompareClientError("[compare] unexpected curve batch failure", error);
        if (!cancelled) {
          setCurveErrors((prev) => {
            const next = new Map(prev);
            need.forEach((name) => next.set(name.toLowerCase(), name));
            return next;
          });
        }
      } finally {
        need.forEach((n) => pendingRef.current.delete(n.toLowerCase()));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [engine, repos, curves, curveErrors]);

  const orderedCurves = useMemo(
    () => repos.map((n) => curves.get(n.toLowerCase())).filter((c): c is CompareCurve => Boolean(c)),
    [repos, curves],
  );
  const failedRepos = useMemo(
    () =>
      repos
        .map((name) => {
          const key = name.toLowerCase();
          const failedName = curveErrors.get(key);
          return failedName ? { key, name: failedName } : null;
        })
        .filter((entry): entry is { key: string; name: string } => Boolean(entry)),
    [repos, curveErrors],
  );
  const selectedFacts = useMemo(
    () =>
      repos.map((name) => {
        const key = name.toLowerCase();
        const curve = curves.get(key);
        const doc = engine?.byFullName.get(key);
        return {
          key,
          name,
          currentStars: curve?.current_stars ?? doc?.current_stars ?? null,
          crossed10k: curve ? formatCrossed10k(curve.crossed_10k) : curveErrors.has(key) ? "-" : labels.pickerLoading,
        };
      }),
    [repos, curves, engine, curveErrors, labels.pickerLoading],
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
      updateRepos(repos.filter((n) => n.toLowerCase() !== fullName.toLowerCase()));
      setCurveErrors((prev) => {
        const next = new Map(prev);
        next.delete(fullName.toLowerCase());
        return next;
      });
    },
    [repos, updateRepos],
  );

  const retry = useCallback((fullName: string) => {
    const key = fullName.toLowerCase();
    pendingRef.current.delete(key);
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
    <div className="grid gap-4 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] lg:items-start">
      <section aria-label={labels.pickerPlaceholder} className="rounded-lg border border-outline-variant bg-surface-container p-4">
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
        {q.trim() && hits.length === 0 && (
          <p role="status" aria-live="polite" className="mt-2 px-3 font-mono text-[0.75rem] text-on-surface-variant">
            {pickerError ? labels.pickerLoadError : engine ? labels.pickerEmpty : labels.pickerLoading}
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
        {failedRepos.length > 0 && (
          <ul className="mt-3 space-y-2" aria-live="polite">
            {failedRepos.map((entry) => (
              <li
                key={entry.key}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[color:var(--chart-cat-5)] bg-surface-container-high px-3 py-2 font-mono text-[0.75rem] text-on-surface"
              >
                <span>{formatRepoLabel(labels.loadError, entry.name)}</span>
                <span className="inline-flex gap-2">
                  <button
                    type="button"
                    onClick={() => retry(entry.name)}
                    className="min-h-9 rounded-full bg-surface px-3 py-1 font-semibold text-on-surface transition-colors hover:bg-on-surface/10"
                  >
                    {labels.retry}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(entry.name)}
                    className="min-h-9 rounded-full bg-surface px-3 py-1 font-semibold text-on-surface transition-colors hover:bg-on-surface/10"
                  >
                    {labels.remove}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="min-w-0 overflow-hidden rounded-lg border border-outline-variant bg-surface-container px-4 py-4">
        {selectedFacts.length > 0 && (
          <dl aria-label={labels.repoCurveSource} className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {selectedFacts.map((fact) => (
              <div key={fact.key} className="min-w-0 rounded-lg bg-surface-container-high px-3 py-3">
                <dt className="break-all font-mono text-[0.82rem] font-semibold text-on-surface">{fact.name}</dt>
                <dd className="mt-2 grid grid-cols-2 gap-3 font-mono text-[0.72rem] text-on-surface-variant">
                  <span className="min-w-0">
                    <span className="block uppercase tracking-wider">{labels.currentStars}</span>
                    <span className="mt-0.5 block text-[0.82rem] font-extrabold tabular-nums text-on-surface">
                      {fact.currentStars === null ? labels.pickerLoading : `${fmtStars(fact.currentStars)} ★`}
                    </span>
                  </span>
                  <span className="min-w-0 text-right">
                    <span className="block uppercase tracking-wider">{labels.tenKMonths}</span>
                    <span className="mt-0.5 block text-[0.82rem] font-extrabold tabular-nums text-on-surface">{fact.crossed10k}</span>
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div className={selectedFacts.length > 0 ? "mt-5 min-w-0" : "min-w-0"}>
          {orderedCurves.length >= MIN_COMPARE ? (
            <CompareCurveChart
              curves={orderedCurves}
              modeLabels={{ absolute: labels.modeAbsolute, align10k: labels.modeAlign10k }}
              legendAria={labels.legendLabel}
              ariaLabels={{ compareModes: labels.compareModesAria, starHistoryOverlay: labels.starHistoryOverlayAria }}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-outline-variant px-4 py-8 text-center font-mono text-[0.85rem] text-on-surface-variant">
              {orderedCurves.length === 1 ? labels.minHint : labels.empty}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
