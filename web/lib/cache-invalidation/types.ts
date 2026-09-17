export type RevalidateType = "page" | "layout";

export type RevalidateTagOptions = {
  expire?: number;
};

export type CacheInvalidationOp =
  | { kind: "path"; path: string; type?: RevalidateType }
  | { kind: "tag"; tag: string; options?: RevalidateTagOptions };

export type CacheInvalidationPort = {
  revalidatePath(path: string, type?: RevalidateType): Promise<void>;
  revalidateTag(tag: string, options?: RevalidateTagOptions): Promise<void>;
};

export type NextCacheApi = {
  revalidatePath(path: string, type?: RevalidateType): void;
  revalidateTag(tag: string, options?: RevalidateTagOptions): void;
};
