import { createHash } from "node:crypto";

export const BOOTSTRAP_POINTER_PATH = "bootstrap/latest.json";
export const BOOTSTRAP_SCHEMA_VER = 1;
export const BOOTSTRAP_PHASES = ["base", "canonical"];
export const LEGACY_FLAT_TARGET = "legacy-flat";
export const LEGACY_FLAT_REQUIRED_PATHS = [
  "meta.json",
  "lookup/repos.json",
  "lookup/orgs.json",
  "rank/all-time/repo/stock.json",
  "rank/all-time/org/stock.json",
  "canonical/v2/meta.json",
  ...Array.from({ length: 32 }, (_, bucket) => [
    `canonical/v2/repos/${bucket}.json`,
    `canonical/v2/repo-monthly/${bucket}.json`,
    `canonical/v2/repo-weekly/${bucket}.json`,
    `canonical/v2/repo-recent-daily/${bucket}.json`,
  ]).flat(),
];

export function assertBootstrapGeneration(value) {
  if (!/^bootstrap-[A-Za-z0-9][A-Za-z0-9._-]{2,120}$/.test(value ?? "")) {
    throw new Error(`invalid bootstrap generation "${value ?? ""}"; use bootstrap-<specific-id>`);
  }
  return value;
}

export function bootstrapGenerationPrefix(generation) {
  return `bootstrap/generations/${assertBootstrapGeneration(generation)}`;
}

export function bootstrapPhaseManifestPath(generation, phase) {
  assertPhase(phase);
  return `${bootstrapGenerationPrefix(generation)}/manifests/${phase}.json`;
}

export function sha256Bytes(body) {
  return createHash("sha256").update(body).digest("hex");
}

function assertPhase(phase) {
  if (!BOOTSTRAP_PHASES.includes(phase)) throw new Error(`invalid bootstrap phase "${phase}"`);
}

function normalizeItemPath(path) {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || normalized.includes("://")) {
    throw new Error(`invalid staged object path "${path}"`);
  }
  return normalized;
}

function assertPhaseObjectPath(phase, path) {
  const valid =
    phase === "base"
      ? path.startsWith("views/") || path === "canonical/star_daily.parquet"
      : path.startsWith("canonical/v2/") && path.endsWith(".json");
  if (!valid) throw new Error(`${phase} phase cannot stage object path "${path}"`);
}

function bodyBuffer(body) {
  return Buffer.isBuffer(body) ? body : Buffer.from(body);
}

export function buildBootstrapPhaseManifest(generation, phase, items) {
  assertBootstrapGeneration(generation);
  assertPhase(phase);
  const seen = new Set();
  const objects = items
    .map((item) => {
      const path = normalizeItemPath(item.path);
      assertPhaseObjectPath(phase, path);
      if (seen.has(path)) throw new Error(`duplicate staged object path "${path}"`);
      seen.add(path);
      const body = bodyBuffer(item.body);
      return { path, bytes: body.byteLength, sha256: sha256Bytes(body) };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  if (objects.length === 0) throw new Error(`${phase} bootstrap phase cannot be empty`);
  return {
    schema_ver: BOOTSTRAP_SCHEMA_VER,
    generation,
    phase,
    object_count: objects.length,
    total_bytes: objects.reduce((sum, item) => sum + item.bytes, 0),
    objects,
  };
}

function manifestBytes(manifest) {
  return Buffer.from(JSON.stringify(manifest));
}

function parseJson(body, path) {
  try {
    return JSON.parse(body.toString("utf8"));
  } catch (error) {
    throw new Error(`${path}: malformed JSON — ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parsePhaseManifest(body, generation, phase) {
  const path = bootstrapPhaseManifestPath(generation, phase);
  const manifest = parseJson(body, path);
  const seen = new Set();
  const objectsValid = Array.isArray(manifest?.objects) && manifest.objects.every((item) => {
    if (
      typeof item?.path !== "string" ||
      !Number.isInteger(item?.bytes) ||
      item.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(item?.sha256 ?? "") ||
      seen.has(item.path)
    ) return false;
    try {
      assertPhaseObjectPath(phase, normalizeItemPath(item.path));
    } catch {
      return false;
    }
    seen.add(item.path);
    return true;
  });
  if (
    manifest?.schema_ver !== BOOTSTRAP_SCHEMA_VER ||
    manifest?.generation !== generation ||
    manifest?.phase !== phase ||
    !objectsValid ||
    manifest.objects.length === 0 ||
    manifest.object_count !== manifest.objects.length ||
    manifest.total_bytes !== manifest.objects.reduce((sum, item) => sum + Number(item.bytes), 0)
  ) {
    throw new Error(`${path}: invalid bootstrap phase manifest`);
  }
  return manifest;
}

function assertExactObject(path, actual, expected) {
  if (!actual) throw new Error(`${path}: staged object is missing`);
  const actualHash = sha256Bytes(actual);
  if (actual.byteLength !== expected.bytes || actualHash !== expected.sha256) {
    throw new Error(`${path}: immutable staged object differs from its manifest`);
  }
}

async function mapPool(items, concurrency, worker) {
  let index = 0;
  const outputs = [];
  async function run() {
    while (index < items.length) {
      const current = index++;
      outputs[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, run));
  return outputs;
}

/**
 * Prove the pre-bootstrap flat layout is still a usable recovery target. The
 * bootstrap process never overwrites these paths; rollback removes only the
 * bootstrap pointer after representative base views and every required
 * bucketed canonical family parse successfully.
 */
export async function verifyLegacyFlatTarget({ store, concurrency = 12 }) {
  const files = await mapPool(LEGACY_FLAT_REQUIRED_PATHS, concurrency, async (path) => {
    const body = await store.read(path);
    if (!body) throw new Error(`${path}: required legacy-flat recovery artifact is missing`);
    const parsed = parseJson(body, path);
    if (parsed === null || typeof parsed !== "object") {
      throw new Error(`${path}: invalid legacy-flat recovery artifact`);
    }
    if (Array.isArray(parsed)) throw new Error(`${path}: legacy-flat recovery artifact must be an object`);
    if (path === "meta.json" || path === "canonical/v2/meta.json") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.seam_date ?? "") || !Number.isInteger(parsed.schema_ver)) {
        throw new Error(`${path}: invalid legacy-flat recovery metadata`);
      }
    } else if (path.startsWith("lookup/") && Object.keys(parsed).length === 0) {
      throw new Error(`${path}: legacy-flat recovery lookup cannot be empty`);
    } else if (path.startsWith("rank/") && !Array.isArray(parsed.items)) {
      throw new Error(`${path}: invalid legacy-flat recovery ranking`);
    }
    return { path, bytes: body.byteLength, sha256: sha256Bytes(body) };
  });
  return {
    target: LEGACY_FLAT_TARGET,
    objectCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
  };
}

/**
 * Create one immutable generation phase. Existing byte-identical objects are
 * reused, which makes the same generation safe to resume after interruption.
 */
export async function stageBootstrapPhase({ generation, phase, items, store, concurrency = 12, onProgress = (_progress) => {} }) {
  const prefix = bootstrapGenerationPrefix(generation);
  const manifest = buildBootstrapPhaseManifest(generation, phase, items);
  const expectedManifestBytes = manifestBytes(manifest);
  const manifestPath = bootstrapPhaseManifestPath(generation, phase);
  const existingManifest = await store.read(manifestPath);
  if (existingManifest) {
    if (!existingManifest.equals(expectedManifestBytes)) {
      throw new Error(`${manifestPath}: generation phase is already sealed with different content`);
    }
    await verifyBootstrapPhase({ generation, phase, store });
    return { status: "resumed", created: 0, reused: manifest.object_count, manifest };
  }

  const sourceByPath = new Map(items.map((item) => [normalizeItemPath(item.path), item]));
  let completed = 0;
  const results = await mapPool(manifest.objects, concurrency, async (expected) => {
    const physicalPath = `${prefix}/${expected.path}`;
    const source = sourceByPath.get(expected.path);
    if (!source) throw new Error(`${expected.path}: local source disappeared while staging`);
    const body = bodyBuffer(source.body);
    const existing = await store.read(physicalPath);
    let created = false;
    if (existing) {
      assertExactObject(physicalPath, existing, expected);
    } else {
      created = await store.create(physicalPath, body, source.contentType);
      if (!created) assertExactObject(physicalPath, await store.read(physicalPath), expected);
    }
    completed++;
    onProgress({ completed, total: manifest.object_count, path: expected.path, created });
    return created;
  });

  const sealed = await store.create(manifestPath, expectedManifestBytes, "application/json");
  if (!sealed) {
    const raced = await store.read(manifestPath);
    if (!raced?.equals(expectedManifestBytes)) throw new Error(`${manifestPath}: manifest create conflict`);
  }
  const created = results.filter(Boolean).length;
  return { status: "staged", created, reused: manifest.object_count - created, manifest };
}

export async function verifyBootstrapPhase({ generation, phase, store, concurrency = 12 }) {
  const manifestPath = bootstrapPhaseManifestPath(generation, phase);
  const rawManifest = await store.read(manifestPath);
  if (!rawManifest) throw new Error(`${manifestPath}: required phase manifest is missing`);
  const manifest = parsePhaseManifest(rawManifest, generation, phase);
  const prefix = bootstrapGenerationPrefix(generation);
  await mapPool(manifest.objects, concurrency, async (expected) => {
    const path = `${prefix}/${expected.path}`;
    assertExactObject(path, await store.read(path), expected);
  });
  return { manifest, sha256: sha256Bytes(rawManifest) };
}

export async function verifyBootstrapGeneration({ generation, store, concurrency = 12 }) {
  const [base, canonical] = await Promise.all(
    BOOTSTRAP_PHASES.map((phase) => verifyBootstrapPhase({ generation, phase, store, concurrency })),
  );
  return {
    base,
    canonical,
    objectCount: base.manifest.object_count + canonical.manifest.object_count,
    totalBytes: base.manifest.total_bytes + canonical.manifest.total_bytes,
  };
}

function parsePointer(body) {
  if (!body) return null;
  const pointer = parseJson(body, BOOTSTRAP_POINTER_PATH);
  if (
    pointer?.schema_ver !== BOOTSTRAP_SCHEMA_VER ||
    typeof pointer?.generation !== "string" ||
    pointer.prefix !== bootstrapGenerationPrefix(pointer.generation) ||
    (pointer.previous_generation !== null &&
      !/^bootstrap-[A-Za-z0-9][A-Za-z0-9._-]{2,120}$/.test(pointer.previous_generation ?? "")) ||
    !Number.isFinite(Date.parse(pointer.published_at)) ||
    !/^[a-f0-9]{64}$/.test(pointer.base_manifest_sha256 ?? "") ||
    !/^[a-f0-9]{64}$/.test(pointer.canonical_manifest_sha256 ?? "")
  ) {
    throw new Error(`${BOOTSTRAP_POINTER_PATH}: invalid bootstrap pointer`);
  }
  return pointer;
}

export async function commitBootstrapGeneration({
  generation,
  store,
  validate = async (_verified) => {},
  assertCanCommit = async () => {},
  now = () => new Date().toISOString(),
}) {
  assertBootstrapGeneration(generation);
  const verified = await verifyBootstrapGeneration({ generation, store });
  await validate(verified);
  await assertCanCommit();
  const current = parsePointer(await store.read(BOOTSTRAP_POINTER_PATH));
  // null is an explicit legacy-flat recovery edge, not "no rollback". Prove
  // that mutable flat state while holding the shared writer lease before the
  // first pointer can hide it.
  if (!current) {
    await verifyLegacyFlatTarget({ store });
    await assertCanCommit();
  }
  if (current?.generation === generation) {
    if (
      current.base_manifest_sha256 !== verified.base.sha256 ||
      current.canonical_manifest_sha256 !== verified.canonical.sha256
    ) {
      throw new Error(`${BOOTSTRAP_POINTER_PATH}: published generation manifest digest changed`);
    }
    return { status: "already-published", pointer: current, verified };
  }
  const pointer = {
    schema_ver: BOOTSTRAP_SCHEMA_VER,
    generation,
    prefix: bootstrapGenerationPrefix(generation),
    previous_generation: current?.generation ?? null,
    published_at: now(),
    base_manifest_sha256: verified.base.sha256,
    canonical_manifest_sha256: verified.canonical.sha256,
  };
  await store.put(BOOTSTRAP_POINTER_PATH, Buffer.from(JSON.stringify(pointer)), "application/json");
  return { status: "published", pointer, verified };
}

export async function rollbackBootstrapGeneration({
  store,
  targetGeneration,
  assertCanCommit = async () => {},
  now = () => new Date().toISOString(),
}) {
  if (targetGeneration === LEGACY_FLAT_TARGET) {
    // Unlike sealed generations, legacy-flat canonical paths are mutable.
    // Acquire the shared writer lease first, validate while managed refresh is
    // excluded, then read the pointer and retain ownership through deletion or
    // the idempotent no-pointer retry decision.
    await assertCanCommit();
    const verified = await verifyLegacyFlatTarget({ store });
    await assertCanCommit();
    const current = parsePointer(await store.read(BOOTSTRAP_POINTER_PATH));
    if (!current) {
      return {
        status: "already-rolled-back",
        target: LEGACY_FLAT_TARGET,
        pointer: null,
        previousPointer: null,
        verified,
      };
    }
    if (typeof store.delete !== "function") throw new Error("bootstrap store does not support atomic pointer deletion");
    await store.delete(BOOTSTRAP_POINTER_PATH);
    return {
      status: "rolled-back",
      target: LEGACY_FLAT_TARGET,
      pointer: null,
      previousPointer: current,
      verified,
    };
  }

  const target = assertBootstrapGeneration(targetGeneration);
  // Sealed target verification is read-only and can be expensive, so do it
  // before taking the lease. Once acquired, re-read the live pointer and keep
  // ownership through the single write and every no-op retry decision.
  const verified = await verifyBootstrapGeneration({ generation: target, store });
  await assertCanCommit();
  const current = parsePointer(await store.read(BOOTSTRAP_POINTER_PATH));
  if (!current) throw new Error("cannot roll back before the first bootstrap publication");
  if (target === current.generation) {
    if (
      current.base_manifest_sha256 !== verified.base.sha256 ||
      current.canonical_manifest_sha256 !== verified.canonical.sha256
    ) {
      throw new Error(`${BOOTSTRAP_POINTER_PATH}: current generation manifest digest changed`);
    }
    return { status: "already-rolled-back", target, pointer: current, previousPointer: current, verified };
  }
  const pointer = {
    schema_ver: BOOTSTRAP_SCHEMA_VER,
    generation: target,
    prefix: bootstrapGenerationPrefix(target),
    previous_generation: current.generation,
    published_at: now(),
    base_manifest_sha256: verified.base.sha256,
    canonical_manifest_sha256: verified.canonical.sha256,
  };
  await store.put(BOOTSTRAP_POINTER_PATH, Buffer.from(JSON.stringify(pointer)), "application/json");
  return { status: "rolled-back", target, pointer, previousPointer: current, verified };
}
