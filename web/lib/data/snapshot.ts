import { cache } from "react";
import {
  CurrentMonth,
  CurrentMonthDocument,
  CurrentMonthShard,
  HotSnapshot,
  type CurrentMonth as CurrentMonthData,
} from "@/lib/contracts";
import { assembleCurrentMonth, currentMonthShardPath, isCurrentMonthIndex } from "./current-month-shards";
import { readAuthoritativeView, readView, type ViewOpts } from "./source";

// Daily live tail (written by cron, M4). All reads resolve through the same
// live/latest.json generation pointer. A missing pointer falls back to the old
// flat layout only during migration. current_month is an index + 32 shards in
// new generations; legacy generations remain a single CurrentMonth document.

const today = () => new Date().toISOString().slice(0, 10);

const liveCurrentMonthOpts = (): ViewOpts => ({
  live: true,
  legacyPath: "current_month.json",
  bust: today(),
});

async function loadCurrentMonth(
  read: typeof readView | typeof readAuthoritativeView,
  missingShards: "omit" | "throw",
): Promise<CurrentMonthData | null> {
  const opts = liveCurrentMonthOpts();
  const document = await read("current_month.json", CurrentMonthDocument, opts);
  if (document === null) return null;
  if (!isCurrentMonthIndex(document)) return CurrentMonth.parse(document);

  const shards = await Promise.all(
    Array.from({ length: document.shard_count }, (_, bucket) =>
      read(currentMonthShardPath(bucket), CurrentMonthShard, opts),
    ),
  );
  const missing = shards.flatMap((shard, bucket) => (shard === null ? [bucket] : []));
  if (missing.length > 0) {
    if (missingShards === "throw") {
      throw new Error(`current_month missing shard bucket(s) ${missing.join(",")}`);
    }
    return null;
  }
  return assembleCurrentMonth(
    document,
    shards.map((shard) => {
      if (shard === null) throw new Error("current_month shard disappeared after presence check");
      return shard;
    }),
  );
}

export const getHotSnapshot = cache(() =>
  readView("hot-snapshot.json", HotSnapshot, { live: true, legacyPath: "hot-snapshot.json", bust: today() }),
);
export const getCurrentMonth = cache(() => loadCurrentMonth(readView, "omit"));

/** Cron mutation inputs: only a confirmed 404 may be represented as null. */
export const getHotSnapshotAuthoritative = () =>
  readAuthoritativeView("hot-snapshot.json", HotSnapshot, {
    live: true,
    legacyPath: "hot-snapshot.json",
    bust: today(),
  });
export const getCurrentMonthAuthoritative = () => loadCurrentMonth(readAuthoritativeView, "throw");
