import { readdirSync } from "node:fs";

export interface ParityLeaf {
  path: string;
  a: unknown;
  b: unknown;
  numeric: boolean;
}

const IGNORE = new Set(["generated_at", "backfilled_at"]);

export const PARITY_LIVE_ARTIFACTS = new Set(["hot-snapshot.json", "current_month.json"]);

export function diffParityValues(a: unknown, b: unknown, path: string, out: ParityLeaf[]): void {
  if (a === b) return;
  const ta = Array.isArray(a) ? "array" : a === null ? "null" : typeof a;
  const tb = Array.isArray(b) ? "array" : b === null ? "null" : typeof b;
  if (ta !== tb) {
    out.push({ path, a, b, numeric: false });
    return;
  }
  if (ta === "array") {
    const aa = a as unknown[];
    const bb = b as unknown[];
    if (aa.length !== bb.length) {
      out.push({ path: `${path}.length`, a: aa.length, b: bb.length, numeric: false });
      return;
    }
    for (let i = 0; i < aa.length; i++) diffParityValues(aa[i], bb[i], `${path}[${i}]`, out);
  } else if (ta === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)].filter((key) => !IGNORE.has(key)));
    for (const key of keys) {
      if (!(key in ao) || !(key in bo)) {
        out.push({ path: `${path}.${key}`, a: ao[key], b: bo[key], numeric: false });
        continue;
      }
      diffParityValues(ao[key], bo[key], `${path}.${key}`, out);
    }
  } else {
    out.push({ path, a, b, numeric: ta === "number" });
  }
}

export function compareParityView(rel: string, produced: unknown, disk: unknown): ParityLeaf[] {
  if (rel === "meta.json") {
    const published = produced as Record<string, unknown>;
    const stored = disk as Record<string, unknown>;
    const out: ParityLeaf[] = [];
    diffParityValues(published.seam_date, stored.seam_date, "seam_date", out);
    diffParityValues(published.schema_ver, stored.schema_ver, "schema_ver", out);
    return out;
  }
  if (rel.endsWith("/repo/new.json")) {
    const norm = (value: unknown) => {
      const copy = { ...(value as { items: Array<{ value: number; id: number }> }) };
      copy.items = [...copy.items]
        .sort((left, right) => right.value - left.value || left.id - right.id)
        .map((item, index) => ({ ...item, rank: index + 1 }));
      return copy;
    };
    produced = norm(produced);
    disk = norm(disk);
  }
  if (rel.startsWith("entity/org/")) {
    const norm = (value: unknown) => {
      const copy = { ...(value as Record<string, unknown>) };
      if (Array.isArray(copy.members)) copy.members = [...copy.members].sort((left, right) => Number(left) - Number(right));
      return copy;
    };
    produced = norm(produced);
    disk = norm(disk);
  }
  const out: ParityLeaf[] = [];
  diffParityValues(produced, disk, "", out);
  return out;
}

export type ParityLeafClass = {
  kind: "exact" | "rounding" | "mismatch";
  maxDelta: number;
  maxDeltaWhere: string;
  sample: string;
};

export function classifyParityLeaves(rel: string, leaves: ParityLeaf[]): ParityLeafClass {
  if (leaves.length === 0) return { kind: "exact", maxDelta: 0, maxDeltaWhere: "", sample: "" };
  const allNumericTiny = leaves.every((leaf) => leaf.numeric && Math.abs(Number(leaf.a) - Number(leaf.b)) <= 1);
  let maxDelta = 0;
  let maxDeltaWhere = "";
  for (const leaf of leaves) {
    if (!leaf.numeric) continue;
    const delta = Math.abs(Number(leaf.a) - Number(leaf.b));
    if (delta > maxDelta) {
      maxDelta = delta;
      maxDeltaWhere = `${rel}${leaf.path}: ${leaf.a} vs ${leaf.b}`;
    }
  }
  if (allNumericTiny) {
    return {
      kind: "rounding",
      maxDelta,
      maxDeltaWhere,
      sample: `${rel}  Δ@${leaves[0].path}: ${leaves[0].a} vs ${leaves[0].b} (${leaves.length} leaves)`,
    };
  }
  return {
    kind: "mismatch",
    maxDelta,
    maxDeltaWhere,
    sample: `${rel}  [${leaves.length} diffs] e.g. ${leaves[0].path}: ${JSON.stringify(leaves[0].a)} vs ${JSON.stringify(leaves[0].b)}`,
  };
}

export function parityIsOk(input: {
  mismatch: number;
  missingOnDisk: number;
  notProduced: number;
  maxDelta: number;
}): boolean {
  return input.mismatch === 0 && input.missingOnDisk === 0 && input.notProduced === 0 && input.maxDelta <= 1;
}

export function excludeParityLiveArtifacts(files: readonly string[]): string[] {
  return files.filter((file) => !PARITY_LIVE_ARTIFACTS.has(file));
}

export function walkParityFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${name.name}` : name.name;
    if (name.isDirectory()) out.push(...walkParityFiles(`${dir}/${name.name}`, rel));
    else out.push(rel);
  }
  return out;
}
