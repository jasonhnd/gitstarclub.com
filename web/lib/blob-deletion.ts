export interface BlobDeletionContext {
  currentViewVersion?: string | null;
  rollbackViewVersion?: string | null;
  activeWorkflowRun?: string | null;
  currentBootstrapGeneration?: string | null;
  rollbackBootstrapGeneration?: string | null;
}

export interface BlobInventoryItem {
  url: string;
  pathname: string;
  size: number;
}

export interface BlobInventoryPage {
  blobs: BlobInventoryItem[];
  cursor?: string;
}

export interface BlobDeletionPlan {
  prefix: string;
  objects: BlobInventoryItem[];
  objectCount: number;
  totalBytes: number;
}

export interface BlobDeletionLeaseGuard {
  /** Renew/prove ownership of ops/workflows/active.json. */
  ensureOwnership(): Promise<void>;
  /** Read current/rollback protection state while that ownership is held. */
  readContext(): Promise<BlobDeletionContext>;
}

export type BlobInventoryLister = (args: {
  prefix: string;
  cursor?: string;
  limit: number;
}) => Promise<BlobInventoryPage>;

const STATIC_PROTECTED_PATHS = [
  "bootstrap/latest.json",
  "categories/",
  "canonical/",
  "current_month.json",
  "entity/",
  "heatmap/",
  "hot-snapshot.json",
  "live/",
  "lookup/",
  "ops/",
  "rank/",
  "search/",
  "views/latest.json",
] as const;

// These are container roots, not deletable generations. They cannot be part of
// the overlap list because safe throwaway descendants must remain deletable.
const BROAD_CONTAINER_PREFIXES = ["bootstrap/", "bootstrap/generations/", "bootstrap/overlays/", "views/"] as const;

export function normalizeBlobDeletionPrefix(input: string): string {
  const prefix = input.trim().replaceAll("\\", "/");
  if (
    prefix.length < 8 ||
    prefix.startsWith("/") ||
    prefix.includes("..") ||
    prefix.includes("://") ||
    !prefix.endsWith("/") ||
    prefix.split("/").filter(Boolean).length < 2
  ) {
    throw new Error(
      `refusing unsafe Blob prefix "${input}"; use a specific directory such as views/verify-123/`,
    );
  }
  return prefix.replace(/\/{2,}/g, "/");
}

function protectedSegment(kind: string, value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,160}$/.test(value)) {
    throw new Error(`cannot safely resolve protected ${kind} identifier "${value}"`);
  }
  return value;
}

function generationPrefix(generation: string): string {
  return `bootstrap/generations/${protectedSegment("bootstrap generation", generation)}/`;
}

function generationOverlayPrefix(generation: string): string {
  return `bootstrap/overlays/${protectedSegment("bootstrap generation", generation)}/`;
}

function viewPrefix(version: string): string {
  return `views/${protectedSegment("view version", version)}/`;
}

/** True when deleting either path could remove all or part of the other path. */
export function blobPrefixesOverlap(left: string, right: string): boolean {
  return left.startsWith(right) || right.startsWith(left);
}

export function protectedBlobPaths(context: BlobDeletionContext = {}): string[] {
  const dynamic = [
    context.currentViewVersion ? viewPrefix(context.currentViewVersion) : null,
    context.rollbackViewVersion ? viewPrefix(context.rollbackViewVersion) : null,
    context.activeWorkflowRun ? viewPrefix(context.activeWorkflowRun) : null,
    context.currentBootstrapGeneration ? generationPrefix(context.currentBootstrapGeneration) : null,
    context.rollbackBootstrapGeneration ? generationPrefix(context.rollbackBootstrapGeneration) : null,
    context.currentBootstrapGeneration ? generationOverlayPrefix(context.currentBootstrapGeneration) : null,
    context.rollbackBootstrapGeneration ? generationOverlayPrefix(context.rollbackBootstrapGeneration) : null,
  ].filter((path): path is string => path !== null);
  return [...new Set([...STATIC_PROTECTED_PATHS, ...dynamic])];
}

export function assertBlobDeletionAllowed(input: string, context: BlobDeletionContext = {}): string {
  const prefix = normalizeBlobDeletionPrefix(input);
  if (BROAD_CONTAINER_PREFIXES.includes(prefix as (typeof BROAD_CONTAINER_PREFIXES)[number])) {
    throw new Error(`refusing to delete broad Blob container "${prefix}"`);
  }
  const conflict = protectedBlobPaths(context).find((protectedPath) =>
    blobPrefixesOverlap(prefix, protectedPath),
  );
  if (conflict) {
    throw new Error(`refusing to delete protected Blob prefix "${prefix}"; overlaps "${conflict}"`);
  }
  return prefix;
}

export async function planBlobPrefixDeletion(
  input: string,
  context: BlobDeletionContext,
  listPage: BlobInventoryLister,
): Promise<BlobDeletionPlan> {
  const prefix = assertBlobDeletionAllowed(input, context);
  const objects: BlobInventoryItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await listPage({ prefix, cursor, limit: 1000 });
    objects.push(...page.blobs);
    cursor = page.cursor;
  } while (cursor);
  return {
    prefix,
    objects,
    objectCount: objects.length,
    totalBytes: objects.reduce((sum, blob) => sum + blob.size, 0),
  };
}

export async function executeBlobDeletionPlan(
  plan: BlobDeletionPlan,
  confirmation: string,
  guard: BlobDeletionLeaseGuard,
  deleteUrls: (urls: string[]) => Promise<void>,
  chunkSize = 100,
): Promise<number> {
  if (confirmation !== plan.prefix) {
    throw new Error(`execute confirmation must exactly equal "${plan.prefix}"`);
  }
  let deleted = 0;
  for (let index = 0; index < plan.objects.length; index += chunkSize) {
    const urls = plan.objects.slice(index, index + chunkSize).map((blob) => blob.url);
    if (urls.length === 0) continue;
    // Publication and rollback use the same workflow lease. Renew before the
    // protection read, re-resolve both pointers, then prove fencing ownership
    // once more immediately before the destructive call. A target that became
    // current/rollback after preview is rejected, and a publisher cannot enter
    // the checked-to-delete interval.
    await guard.ensureOwnership();
    assertBlobDeletionAllowed(plan.prefix, await guard.readContext());
    await guard.ensureOwnership();
    await deleteUrls(urls);
    deleted += urls.length;
  }
  return deleted;
}
