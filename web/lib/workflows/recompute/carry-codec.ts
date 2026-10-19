import type { RestBucketPartial, RestCarry, RestNewcomer, RestOrg, RestTopRepo } from "./rest-fold";
import type { OwnerType } from "./model";
import type { PackedWindowKind } from "./packed-window";

// Strict codecs for the carry and partial objects the rank and rest hops hand
// to their own next delivery. Absence is the caller's call (the object store
// returns null). Anything that is present but malformed throws with the object
// path and the first failing field, so corruption never reads as "missing".

export type RankCarryFile = {
  v: 1;
  kind: PackedWindowKind;
  dim: "repo" | "org";
  nextPeriod: number;
  flow: Array<[string, number]>;
  stock: Array<[string, number]>;
  orgStock?: Array<[number, number]>;
};

export function rankCarryPath(runId: string, kind: PackedWindowKind, dim: "repo" | "org"): string {
  return `ops/workflows/${runId}/recompute/${kind}-${dim}-carry.json`;
}

function invalid(path: string, label: string, reason: string): Error {
  return new Error(`${path}: invalid ${label} — ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parsePairs<K extends string | number>(
  value: unknown,
  isKey: (key: unknown) => key is K,
  keyType: "string" | "number",
  field: string,
  fail: (reason: string) => Error,
): Array<[K, number]> {
  if (!Array.isArray(value)) throw fail(`${field}: expected an array`);
  return value.map((row, index) => {
    if (!Array.isArray(row) || !isKey(row[0]) || typeof row[1] !== "number") {
      throw fail(`${field}[${index}]: expected [${keyType}, number]`);
    }
    return [row[0], row[1]];
  });
}

const isString = (key: unknown): key is string => typeof key === "string";
const isNumber = (key: unknown): key is number => typeof key === "number";

export function parseRankCarry(
  json: unknown,
  kind: PackedWindowKind,
  dim: "repo" | "org",
  path: string,
): RankCarryFile {
  const fail = (reason: string) => invalid(path, "rank carry", reason);
  if (!isRecord(json)) throw fail("expected an object");
  if (json.v !== 1) throw fail("v: expected 1");
  if (json.kind !== kind) throw fail(`kind: expected ${kind}, got ${String(json.kind)}`);
  if (json.dim !== dim) throw fail(`dim: expected ${dim}, got ${String(json.dim)}`);
  const nextPeriod = json.nextPeriod;
  if (typeof nextPeriod !== "number" || !Number.isInteger(nextPeriod) || nextPeriod < 0) {
    throw fail("nextPeriod: expected a non-negative integer");
  }
  const flow = parsePairs(json.flow, isString, "string", "flow", fail);
  const stock = parsePairs(json.stock, isString, "string", "stock", fail);
  const orgStock =
    json.orgStock === undefined ? undefined : parsePairs(json.orgStock, isNumber, "number", "orgStock", fail);
  return { v: 1, kind, dim, nextPeriod, flow, stock, orgStock };
}

function isOwnerType(value: unknown): value is OwnerType {
  return value === "User" || value === "Organization";
}

function parseTop(value: unknown, fail: (reason: string) => Error): RestTopRepo[] {
  if (!Array.isArray(value)) throw fail("repoTop: expected an array");
  return value.map((row, index) => {
    if (!isRecord(row) || typeof row.id !== "number" || typeof row.stars !== "number") {
      throw fail(`repoTop[${index}]: expected { id: number, stars: number }`);
    }
    return { id: row.id, stars: row.stars };
  });
}

function parseNewcomers(value: unknown, field: string, fail: (reason: string) => Error): Record<string, RestNewcomer[]> {
  if (!isRecord(value)) throw fail(`${field}: expected an object`);
  const out: Record<string, RestNewcomer[]> = {};
  for (const [period, rows] of Object.entries(value)) {
    if (!Array.isArray(rows)) throw fail(`${field}.${period}: expected an array`);
    out[period] = rows.map((row, index) => {
      if (!isRecord(row) || typeof row.id !== "number" || typeof row.stars !== "number" || typeof row.date !== "string") {
        throw fail(`${field}.${period}[${index}]: expected { id: number, stars: number, date: string }`);
      }
      return { id: row.id, stars: row.stars, date: row.date };
    });
  }
  return out;
}

function parseOrgs(value: unknown, fail: (reason: string) => Error): RestOrg[] {
  if (!Array.isArray(value)) throw fail("orgs: expected an array");
  return value.map((row, index) => {
    const at = `orgs[${index}]`;
    if (!isRecord(row)) throw fail(`${at}: expected an object`);
    if (typeof row.login !== "string") throw fail(`${at}.login: expected a string`);
    if (!isOwnerType(row.owner_type)) throw fail(`${at}.owner_type: expected User or Organization`);
    for (const field of ["repo_count", "current_stars_sum", "anchorId"] as const) {
      if (typeof row[field] !== "number") throw fail(`${at}.${field}: expected a number`);
    }
    return {
      login: row.login,
      owner_type: row.owner_type,
      repo_count: row.repo_count as number,
      current_stars_sum: row.current_stars_sum as number,
      anchorId: row.anchorId as number,
    };
  });
}

export function parseRestCarry(json: unknown, path: string): RestCarry {
  const fail = (reason: string) => invalid(path, "rest carry", reason);
  if (!isRecord(json)) throw fail("expected an object");
  if (json.v !== 1) throw fail("v: expected 1");
  if (typeof json.generatedAt !== "string") throw fail("generatedAt: expected a string");
  if (!Array.isArray(json.doneBuckets) || !json.doneBuckets.every((bucket) => typeof bucket === "number")) {
    throw fail("doneBuckets: expected an array of numbers");
  }
  return {
    v: 1,
    generatedAt: json.generatedAt,
    repoTop: parseTop(json.repoTop, fail),
    orgs: parseOrgs(json.orgs, fail),
    newcomersMonth: parseNewcomers(json.newcomersMonth, "newcomersMonth", fail),
    newcomersYear: parseNewcomers(json.newcomersYear, "newcomersYear", fail),
    doneBuckets: json.doneBuckets as number[],
  };
}

export function parseRestPartial(json: unknown, path: string): RestBucketPartial {
  const fail = (reason: string) => invalid(path, "rest partial", reason);
  if (!isRecord(json)) throw fail("expected an object");
  if (json.v !== 1) throw fail("v: expected 1");
  if (!isRecord(json.lookup)) throw fail("lookup: expected an object");
  if (!Array.isArray(json.search)) throw fail("search: expected an array");
  if (!Array.isArray(json.active)) throw fail("active: expected an array");
  if (!isRecord(json.languageLabels)) throw fail("languageLabels: expected an object");
  if (!isRecord(json.assignments)) throw fail("assignments: expected an object");
  return json as unknown as RestBucketPartial;
}
