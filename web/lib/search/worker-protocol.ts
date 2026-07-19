import { SearchDoc as SearchDocSchema, type SearchDoc } from "@/lib/contracts";
import { truncateUnicodeText } from "../unicode-text";
import type { SearchHit } from "./core";

export type SearchLoadState = "idle" | "loading" | "ready" | "error";

export type SearchWorkerErrorCode = "bad-index" | "load-failed" | "worker-init" | "worker-query" | "worker-unavailable";

export interface SearchWorkerError {
  code: SearchWorkerErrorCode;
  message: string;
  details?: string;
}

export type SearchWorkerInMessage =
  | { type: "init"; repos: unknown }
  | { type: "query"; id: number; q: string; limit: number };

export type SearchWorkerOutMessage =
  | { type: "ready" }
  | { type: "results"; id: number; hits: SearchHit[] }
  | { type: "error"; id?: number; error: SearchWorkerError };

const ERROR_MESSAGES: Record<SearchWorkerErrorCode, string> = {
  "bad-index": "Search index data is malformed.",
  "load-failed": "Search could not load.",
  "worker-init": "Search worker could not start.",
  "worker-query": "Search query failed.",
  "worker-unavailable": "Search worker is not ready.",
};

function isDevelopment(): boolean {
  return typeof process !== "undefined" && process.env.NODE_ENV !== "production";
}

function errorDetails(error: unknown): string | undefined {
  if (error instanceof Error) return error.stack ?? error.message;
  if (typeof error === "string") return error;
  return undefined;
}

export function createSearchWorkerError(code: SearchWorkerErrorCode, error?: unknown): SearchWorkerError {
  const details = errorDetails(error);
  return {
    code,
    message: ERROR_MESSAGES[code],
    ...(isDevelopment() && details ? { details: truncateUnicodeText(details, 2000) } : {}),
  };
}

type RepoParseResult = { ok: true; repos: SearchDoc[] } | { ok: false; error: SearchWorkerError };

function parseRepos(value: unknown, error?: unknown): RepoParseResult {
  const parsed = SearchDocSchema.array().safeParse(value);
  if (!parsed.success) return { ok: false, error: createSearchWorkerError("bad-index", error ?? parsed.error) };
  return { ok: true, repos: parsed.data };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSearchIndexPayload(value: unknown): RepoParseResult {
  if (!isRecord(value)) return { ok: false, error: createSearchWorkerError("bad-index", "payload is not an object") };

  const parsed = parseRepos(value.repos);
  if (!parsed.ok) return parsed;

  if ("count" in value) {
    const count = value.count;
    if (!Number.isInteger(count) || Number(count) < 0 || count !== parsed.repos.length) {
      return { ok: false, error: createSearchWorkerError("bad-index", "count must match repos length") };
    }
  }

  return parsed;
}

export function parseSearchWorkerRepos(value: unknown): RepoParseResult {
  return parseRepos(value);
}
