import type { CacheInvalidationOp, CacheInvalidationPort, RevalidateTagOptions, RevalidateType } from "./types";

/** In-process recorder used by tests and as the CF stub ledger. */
export class MemoryCacheInvalidation implements CacheInvalidationPort {
  readonly ops: CacheInvalidationOp[] = [];

  async revalidatePath(path: string, type?: RevalidateType): Promise<void> {
    this.ops.push(type ? { kind: "path", path, type } : { kind: "path", path });
  }

  async revalidateTag(tag: string, options?: RevalidateTagOptions): Promise<void> {
    this.ops.push(options ? { kind: "tag", tag, options } : { kind: "tag", tag });
  }

  paths(): string[] {
    return this.ops.filter((op): op is Extract<CacheInvalidationOp, { kind: "path" }> => op.kind === "path").map((op) => op.path);
  }

  tags(): string[] {
    return this.ops.filter((op): op is Extract<CacheInvalidationOp, { kind: "tag" }> => op.kind === "tag").map((op) => op.tag);
  }
}
