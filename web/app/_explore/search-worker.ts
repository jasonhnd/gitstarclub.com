import { createIndex, queryIndex } from "@/lib/search/core";
import { searchWorkerError, type SearchWorkerInMessage, type SearchWorkerOutMessage } from "@/lib/search/client";

let index: ReturnType<typeof createIndex> | null = null;

function post(message: SearchWorkerOutMessage) {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<SearchWorkerInMessage>) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      index = createIndex(message.repos);
      post({ type: "ready" });
      return;
    }
    if (!index) {
      post(searchWorkerError("not-ready", "Search worker received a query before initialization.", message.id));
      return;
    }
    post({ type: "results", id: message.id, hits: queryIndex(index, message.q, message.limit) });
  } catch (error) {
    post(message.type === "query" ? searchWorkerError("query-failed", error, message.id) : searchWorkerError("init-failed", error));
  }
};
