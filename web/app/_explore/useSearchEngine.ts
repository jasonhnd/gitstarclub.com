"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseSearchIndexPayload, type SearchLoadState, type SearchWorkerOutMessage } from "@/lib/search/client";
import type { SearchHit } from "@/lib/search/core";

export function useSearchEngine({ limit }: { limit: number }) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loadState, setLoadState] = useState<SearchLoadState>("idle");

  const workerRef = useRef<Worker | null>(null);
  const readyRef = useRef(false);
  const loadingRef = useRef(false);
  const pendingRef = useRef<string | null>(null);
  const requestRef = useRef(0);
  const activeRequestRef = useRef(0);
  const disposedRef = useRef(false);

  const setState = useCallback((state: SearchLoadState) => {
    if (!disposedRef.current) setLoadState(state);
  }, []);

  const stopWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    readyRef.current = false;
    loadingRef.current = false;
  }, []);

  const fail = useCallback(() => {
    stopWorker();
    pendingRef.current = null;
    activeRequestRef.current = 0;
    setHits([]);
    setState("error");
  }, [setState, stopWorker]);

  const postQuery = useCallback(
    (value: string) => {
      const worker = workerRef.current;
      if (!worker || !readyRef.current) {
        pendingRef.current = value;
        return false;
      }
      const id = ++requestRef.current;
      activeRequestRef.current = id;
      worker.postMessage({ type: "query", id, q: value, limit });
      return true;
    },
    [limit],
  );

  const ensureEngine = useCallback(async () => {
    if (workerRef.current || loadingRef.current) return;
    loadingRef.current = true;
    setState("loading");

    try {
      const res = await fetch("/search-index", { cache: "force-cache" });
      if (!res.ok) throw new Error(`search-index HTTP ${res.status}`);
      const parsed = parseSearchIndexPayload(await res.json());
      if (!parsed.ok) throw new Error(parsed.message);

      if (disposedRef.current) return;
      const worker = new Worker(new URL("./search-worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<SearchWorkerOutMessage>) => {
        const message = event.data;
        if (message.type === "ready") {
          readyRef.current = true;
          loadingRef.current = false;
          setState("ready");
          if (pendingRef.current != null) {
            const pending = pendingRef.current;
            pendingRef.current = null;
            postQuery(pending);
          }
          return;
        }
        if (message.type === "results" && message.id === activeRequestRef.current) {
          setHits(message.hits);
          return;
        }
        if (message.type === "error" && (message.id === undefined || message.id === activeRequestRef.current)) fail();
      };
      worker.onerror = fail;
      worker.postMessage({ type: "init", repos: parsed.repos });
    } catch {
      fail();
    }
  }, [fail, postQuery, setState]);

  const query = useCallback(
    (value: string) => {
      if (!postQuery(value) && loadState !== "error") void ensureEngine();
    },
    [ensureEngine, loadState, postQuery],
  );

  const retry = useCallback(
    (value: string) => {
      stopWorker();
      pendingRef.current = value;
      void ensureEngine();
    },
    [ensureEngine, stopWorker],
  );

  const clear = useCallback(() => {
    pendingRef.current = null;
    setHits([]);
  }, []);

  useEffect(() => {
    return () => {
      disposedRef.current = true;
      stopWorker();
    };
  }, [stopWorker]);

  return { hits, loadState, ensureEngine, query, retry, clear };
}
