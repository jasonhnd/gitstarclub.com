import { createIndex, queryIndex, type SearchHit } from "@/lib/search/core";
import type { SearchDoc } from "@/lib/contracts";

type InitMessage = { type: "init"; repos: SearchDoc[] };
type QueryMessage = { type: "query"; id: number; q: string; limit: number };
type InMessage = InitMessage | QueryMessage;
type OutMessage = { type: "ready" } | { type: "results"; id: number; hits: SearchHit[] } | { type: "error"; id?: number };

let index: ReturnType<typeof createIndex> | null = null;

function post(message: OutMessage) {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<InMessage>) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      index = createIndex(message.repos);
      post({ type: "ready" });
      return;
    }
    if (!index) {
      post({ type: "results", id: message.id, hits: [] });
      return;
    }
    post({ type: "results", id: message.id, hits: queryIndex(index, message.q, message.limit) });
  } catch {
    post(message.type === "query" ? { type: "error", id: message.id } : { type: "error" });
  }
};
