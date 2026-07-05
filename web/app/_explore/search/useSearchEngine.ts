"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchDoc } from "@/lib/contracts";
import type { SearchHit } from "@/lib/search/core";

type WorkerMessage = { type: "ready" } | { type: "results"; id: number; hits: SearchHit[] } | { type: "error"; id?: number };

export function useSearchEngine({ limit, onResults }: { limit: number; onResults?: (hits: SearchHit[]) => void }) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const readyRef = useRef(false);
  const loadingRef = useRef(false);
  const pendingRef = useRef<string | null>(null);
  const requestRef = useRef(0);
  const activeRequestRef = useRef(0);

  const runQuery = useCallback(
    (value: string) => {
      const worker = workerRef.current;
      if (!worker || !readyRef.current) {
        pendingRef.current = value;
        return;
      }
      const id = ++requestRef.current;
      activeRequestRef.current = id;
      worker.postMessage({ type: "query", id, q: value, limit });
    },
    [limit],
  );

  const ensureEngine = useCallback(async () => {
    if (workerRef.current || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const res = await fetch("/search-index", { cache: "force-cache" });
      const data = (await res.json()) as { repos?: SearchDoc[] };
      const worker = new Worker(new URL("../search-worker.ts", import.meta.url), { type: "module" });
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
          onResults?.(message.hits);
          return;
        }
        if (message.type === "error") {
          setHits([]);
          onResults?.([]);
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
  }, [onResults, runQuery]);

  const query = useCallback(
    (value: string) => {
      if (!readyRef.current) {
        pendingRef.current = value;
        void ensureEngine();
        return;
      }
      runQuery(value);
    },
    [ensureEngine, runQuery],
  );

  const clearHits = useCallback(() => {
    setHits([]);
  }, []);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      readyRef.current = false;
    };
  }, []);

  return { hits, loading, ensureEngine, query, clearHits };
}
