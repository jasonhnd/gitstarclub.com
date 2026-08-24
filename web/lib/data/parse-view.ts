import { z, type ZodType } from "zod";

// Parse a Blob JSON view once per (path, version, schema) in this process.
// Repeated ISR/page reads of the same published generation must not re-parse
// or re-log the same ZodError. See docs/DATA-CONTRACTS.md and FRONTEND.md §3.

type ParseMemoEntry<T> = { ok: true; value: T } | { ok: false; error: Error };

const parseMemo = new Map<string, ParseMemoEntry<unknown>>();
const errorCounts = new Map<
  string,
  { path: string; version: string; fingerprint: string; count: number }
>();
const schemaIds = new WeakMap<ZodType, string>();
let schemaSeq = 0;
const MAX_PARSE_MEMO_ENTRIES = 256;
const MAX_ERROR_FINGERPRINTS = 64;
const MAX_LOGGED_ISSUES = 8;

export type ViewParseContext = {
  path: string;
  version?: string | null;
};

function memoKey(path: string, version: string, schema: ZodType): string {
  return `${path}\0${version}\0${schemaIdentity(schema)}`;
}

function schemaIdentity(schema: ZodType): string {
  const cached = schemaIds.get(schema);
  if (cached) return cached;
  const description = schema.description;
  const id =
    typeof description === "string" && description.length > 0 ? description : `schema#${++schemaSeq}`;
  schemaIds.set(schema, id);
  return id;
}

function pruneMap<K, V>(map: Map<K, V>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) return;
    map.delete(oldest);
  }
}

export function viewParseErrorFingerprint(error: z.ZodError): string {
  return error.issues
    .slice(0, MAX_LOGGED_ISSUES)
    .map((issue) => `${issue.code}:${issue.path.join(".")}:${issue.message}`)
    .join("|");
}

export function resetViewParseStateForTests(): void {
  parseMemo.clear();
  errorCounts.clear();
}

export function viewParseErrorSummary(): Array<{
  path: string;
  version: string;
  fingerprint: string;
  count: number;
}> {
  return [...errorCounts.values()].map((row) => ({ ...row }));
}

/** Workflow/cron end: one line per distinct fingerprint that repeated. */
export function logViewParseErrorSummary(label = "[view-schema]"): void {
  for (const row of viewParseErrorSummary()) {
    if (row.count <= 1) continue;
    console.error(`${label} repeated parse failures`, {
      path: row.path,
      version: row.version || null,
      fingerprint: row.fingerprint,
      count: row.count,
    });
  }
}

function recordParseFailure(path: string, version: string, error: z.ZodError): void {
  const fingerprint = viewParseErrorFingerprint(error);
  const key = `${path}\0${version}\0${fingerprint}`;
  const existing = errorCounts.get(key);
  if (existing) {
    existing.count += 1;
    return;
  }
  errorCounts.set(key, { path, version, fingerprint, count: 1 });
  pruneMap(errorCounts, MAX_ERROR_FINGERPRINTS);
  console.error("[view-schema] parse failed", {
    path,
    version: version || null,
    fingerprint,
    issues: error.issues.slice(0, MAX_LOGGED_ISSUES).map((issue) => ({
      code: issue.code,
      path: issue.path,
      message: issue.message,
    })),
  });
}

/**
 * Strict-parse `json` with `schema`. Successful and failed results are memoized
 * so one published generation is validated once per process.
 */
export function parseView<T>(json: unknown, schema: ZodType<T>, context: ViewParseContext): T {
  const version = context.version ?? "";
  const shouldMemo = version.length > 0;
  const key = memoKey(context.path, version, schema);
  const cached = shouldMemo ? parseMemo.get(key) : undefined;
  if (cached) {
    if (!cached.ok && cached.error instanceof z.ZodError) {
      recordParseFailure(context.path, version, cached.error);
    }
    if (cached.ok) return cached.value as T;
    throw cached.error;
  }

  const result = schema.safeParse(json);
  if (result.success) {
    if (shouldMemo) {
      parseMemo.set(key, { ok: true, value: result.data });
      pruneMap(parseMemo, MAX_PARSE_MEMO_ENTRIES);
    }
    return result.data;
  }

  recordParseFailure(context.path, version, result.error);
  if (shouldMemo) {
    parseMemo.set(key, { ok: false, error: result.error });
    pruneMap(parseMemo, MAX_PARSE_MEMO_ENTRIES);
  }
  throw result.error;
}
