import { OrgEntity, RepoEntity, type OrgsLookup, type ReposLookup } from "@/lib/contracts";
import type { ZodType } from "zod";

const ENTITY_READ_CONCURRENCY = 12;

type ViewReader = <T>(rel: string, schema: ZodType<T>) => Promise<T | null>;

async function mapPool<T>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

/** Full Zod parse of every generated repo/org entity. Complements write-time parse. */
export async function validateGeneratedEntities(
  read: ViewReader,
  lookup: ReposLookup | null,
  orgLookup: OrgsLookup | null,
): Promise<{ invariants: Record<string, number> }> {
  const repoIds = lookup ? Object.keys(lookup) : [];
  const orgLogins = orgLookup ? Object.keys(orgLookup) : [];

  await mapPool(repoIds, ENTITY_READ_CONCURRENCY, async (id) => {
    await read(`entity/repo/${id}.json`, RepoEntity);
  });
  await mapPool(orgLogins, ENTITY_READ_CONCURRENCY, async (login) => {
    await read(`entity/org/${login}.json`, OrgEntity);
  });

  return {
    invariants: {
      entity_repos_checked: repoIds.length,
      entity_orgs_checked: orgLogins.length,
    },
  };
}
