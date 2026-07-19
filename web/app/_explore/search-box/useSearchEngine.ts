"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isAbortError, LatestRequestController } from "@/lib/client/latest-request";
import { fetchSearchIndex } from "@/lib/search/index-fetch";
import {
  acceptSearchResults,
  startSearchQuery,
  type SearchResultSnapshot,
} from "@/lib/search/result-state";
import {
  createSearchWorkerError,
  type SearchLoadState,
  type SearchWorkerError,
  type SearchWorkerOutMessage,
} from "@/lib/search/worker-protocol";

function logSearchFailure(error: SearchWorkerError) {
  if (process.env.NODE_ENV !== "production") {
    console.error(`[search] ${error.code}: ${error.message}`, error.details ?? "");
  }
}

export function useSearchEngine({ limit }: { limit: number }) {
  const [results, setResults] = useState<SearchResultSnapshot>(() => startSearchQuery(""));
  const [loadState, setLoadState] = useState<SearchLoadState>("idle");

  const workerRef = useRef<Worker | null>(null);
  const readyRef = useRef(false);
  const loadingRef = useRef(false);
  const loadStateRef = useRef<SearchLoadState>("idle");
  const pendingRef = useRef<string | null>(null);
  const latestQueryRef = useRef("");
  const requestRef = useRef(0);
  const activeRequestRef = useRef(0);
  const activeQueryRef = useRef("");
  const [loadRequests] = useState(() => new LatestRequestController());

  const setSearchLoadState = useCallback((state: SearchLoadState) => {
    loadStateRef.current = state;
    setLoadState(state);
  }, []);

  const stopWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    readyRef.current = false;
    loadingRef.current = false;
  }, []);

  const resetHits = useCallback(() => {
    setResults(startSearchQuery(""));
  }, []);

  const failSearch = useCallback(
    (error: SearchWorkerError) => {
      logSearchFailure(error);
      pendingRef.current = latestQueryRef.current;
      stopWorker();
      setResults(startSearchQuery(latestQueryRef.current));
      setSearchLoadState("error");
    },
    [setSearchLoadState, stopWorker],
  );

  const postQuery = useCallback(
    (value: string) => {
      const worker = workerRef.current;
      if (!worker || !readyRef.current) return false;
      const id = ++requestRef.current;
      activeRequestRef.current = id;
      activeQueryRef.current = value;
      worker.postMessage({ type: "query", id, q: value, limit });
      return true;
    },
    [limit],
  );

  const query = useCallback(
    (value: string) => {
      latestQueryRef.current = value;
      setResults(startSearchQuery(value));
      if (postQuery(value)) return true;
      pendingRef.current = value;
      return false;
    },
    [postQuery],
  );

  const ensureEngine = useCallback(
    async ({ force = false, query: queuedQuery }: { force?: boolean; query?: string } = {}) => {
      if (queuedQuery !== undefined) {
        latestQueryRef.current = queuedQuery;
        pendingRef.current = queuedQuery;
        setResults(startSearchQuery(queuedQuery));
      }
      if ((workerRef.current || loadingRef.current) && !force) return;
      stopWorker();
      const request = loadRequests.begin();
      loadingRef.current = true;
      readyRef.current = false;
      setSearchLoadState("loading");
      setResults(startSearchQuery(latestQueryRef.current));
      try {
        const result = await fetchSearchIndex({ cache: force ? "reload" : "no-cache", signal: request.signal });
        if (!loadRequests.isCurrent(request.id)) return;
        if (!result.ok) {
          failSearch(result.error);
          return;
        }
        const worker = new Worker(new URL("../search-worker.ts", import.meta.url), { type: "module" });
        workerRef.current = worker;
        worker.onmessage = (event: MessageEvent<SearchWorkerOutMessage>) => {
          if (!loadRequests.isCurrent(request.id) || workerRef.current !== worker) return;
          const message = event.data;
          if (message.type === "ready") {
            readyRef.current = true;
            loadingRef.current = false;
            setSearchLoadState("ready");
            if (pendingRef.current != null) {
              const pending = pendingRef.current;
              pendingRef.current = null;
              query(pending);
            }
            return;
          }
          if (message.type === "results" && message.id === activeRequestRef.current) {
            setResults(acceptSearchResults(activeQueryRef.current, message.hits));
            return;
          }
          if (message.type === "error") {
            failSearch(message.error);
          }
        };
        worker.onerror = (event) => {
          if (!loadRequests.isCurrent(request.id) || workerRef.current !== worker) return;
          failSearch(createSearchWorkerError("worker-init", event.message || event.error));
        };
        worker.postMessage({ type: "init", repos: result.repos });
      } catch (error) {
        if (!loadRequests.isCurrent(request.id) || isAbortError(error)) return;
        failSearch(createSearchWorkerError("load-failed", error));
      } finally {
        loadRequests.finish(request.id);
      }
    },
    [failSearch, loadRequests, query, setSearchLoadState, stopWorker],
  );

  useEffect(() => {
    return () => {
      loadRequests.cancel();
      stopWorker();
    };
  }, [loadRequests, stopWorker]);

  return {
    ensureEngine,
    hits: results.hits,
    loadState,
    query,
    resetHits,
    results,
  };
}
