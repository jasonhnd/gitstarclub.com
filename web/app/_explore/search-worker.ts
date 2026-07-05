import { createIndex, queryIndex } from "@/lib/search/core";
import {
  createSearchWorkerError,
  parseSearchWorkerRepos,
  type SearchWorkerInMessage,
  type SearchWorkerOutMessage,
} from "@/lib/search/worker-protocol";

let index: ReturnType<typeof createIndex> | null = null;

function post(message: SearchWorkerOutMessage) {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<SearchWorkerInMessage>) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      const parsed = parseSearchWorkerRepos(message.repos);
      if (!parsed.ok) {
        index = null;
        post({ type: "error", error: parsed.error });
        return;
      }
      index = createIndex(parsed.repos);
      post({ type: "ready" });
      return;
    }
    if (!index) {
      post({ type: "error", id: message.id, error: createSearchWorkerError("worker-unavailable") });
      return;
    }
    post({ type: "results", id: message.id, hits: queryIndex(index, message.q, message.limit) });
  } catch (error) {
    post(
      message.type === "query"
        ? { type: "error", id: message.id, error: createSearchWorkerError("worker-query", error) }
        : { type: "error", error: createSearchWorkerError("worker-init", error) },
    );
  }
};
