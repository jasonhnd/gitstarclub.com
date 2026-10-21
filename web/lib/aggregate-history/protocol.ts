import { createHash } from "node:crypto";
import { z } from "zod";
import { AGGREGATE_MANIFEST_SHA256 } from "./policy";

export const IMPORT_CHUNK_OBJECTS = 16;
export const IMPORT_CHUNK_BYTES = 4 * 1024 * 1024;
export const IMPORT_REQUEST_BYTES = 8 * 1024 * 1024;
export const IMPORT_VERIFY_OBJECTS = 32;
export const importDigest = (body: string | Uint8Array): string => createHash("sha256").update(body).digest("hex");
export const recoveryGeneration = (generation: string): string => `bootstrap-aggregate-recovery-${importDigest(generation).slice(0, 16)}`;

const generation = z.string().regex(/^bootstrap-aggregate-(?!recovery-)[A-Za-z0-9][A-Za-z0-9._-]{2,100}$/);
const common = { generation, sourceSha256: z.literal(AGGREGATE_MANIFEST_SHA256) };
const ownership = { ...common, token: z.number().int().positive() };
const target = { target: z.string().max(140), phase: z.enum(["base", "canonical"]) };
const path = z.string().min(1).max(512).regex(/^[A-Za-z0-9_/-][A-Za-z0-9._/-]*$/).refine((s) => !s.includes("..") && !s.includes("//"));
const item = z.strictObject({ path, data: z.string().max(IMPORT_REQUEST_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
export const AggregateImportRequest = z.discriminatedUnion("action", [
  z.strictObject({ ...common, action: z.literal("read"), path }),
  z.strictObject({ ...common, action: z.literal("list"), prefix: path, cursor: z.string().max(2048).optional() }),
  z.strictObject({ ...common, action: z.literal("begin") }),
  z.strictObject({ ...ownership, action: z.literal("renew") }),
  z.strictObject({ ...ownership, ...target, action: z.literal("stage"), items: z.array(item).min(1).max(IMPORT_CHUNK_OBJECTS) }),
  z.strictObject({ ...ownership, ...target, action: z.literal("seal"), data: z.string().max(IMPORT_REQUEST_BYTES) }),
  z.strictObject({ ...ownership, ...target, action: z.literal("verify") }),
  z.strictObject({ ...ownership, action: z.literal("commit"), recovery: z.boolean() }),
  z.strictObject({ ...ownership, action: z.literal("release"), status: z.enum(["published", "failed"]) }),
]);
export type AggregateImportRequest = z.infer<typeof AggregateImportRequest>;
export type ImportObject = { path: string; body: Buffer; contentType?: string };
export type ImportPhase = "base" | "canonical";
export type ImportSession = { token: number; generation: string };

export function assertPublicJson(body: Buffer): void {
  const parsed: unknown = JSON.parse(body.toString("utf8"));
  const text = JSON.stringify(parsed);
  if (/\/Users\/|\/home\/|[A-Za-z]:\\(?:\\)?(?:Users|Documents)\\/i.test(text)) {
    throw new Error("Local user paths must never be uploaded");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Import objects must contain JSON objects or arrays");
}

export function readableImportPath(path: string): boolean {
  return ["_meta/bucket-identity.json", "ops/workflows/active.json", "bootstrap/latest.json", "views/latest.json"].includes(path)
    || /^(?:canonical\/v2\/|views\/[^/]+\/|bootstrap\/(?:generations|overlays)\/bootstrap-[^/]+\/)/.test(path);
}

export function assertImportTarget(generation: string, requested: string): void {
  if (requested !== generation && requested !== recoveryGeneration(generation)) throw new Error("Import target is outside this session");
}
