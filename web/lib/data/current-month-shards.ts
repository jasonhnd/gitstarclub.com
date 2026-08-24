import {
  CURRENT_MONTH_SCHEMA_VERSION,
  CURRENT_MONTH_SHARD_COUNT,
  CurrentMonth,
  CurrentMonthIndex,
  CurrentMonthShard,
  type CurrentMonth as CurrentMonthData,
  type CurrentMonthIndex as CurrentMonthIndexData,
  type CurrentMonthShard as CurrentMonthShardData,
} from "@/lib/contracts";

export const CURRENT_MONTH_INDEX_PATH = "current_month.json";
export const currentMonthShardPath = (bucket: number): string => `current_month/shards/${bucket}.json`;

function repoShard(id: number): number {
  return id % CURRENT_MONTH_SHARD_COUNT;
}

export type CurrentMonthShardArtifact = { path: string; data: CurrentMonthShardData };

export function isCurrentMonthIndex(value: unknown): value is CurrentMonthIndexData {
  return CurrentMonthIndex.safeParse(value).success;
}

export function splitCurrentMonth(month: CurrentMonthData): {
  index: CurrentMonthIndexData;
  shards: CurrentMonthShardArtifact[];
} {
  const parsed = CurrentMonth.parse(month);
  const buckets: CurrentMonthShardData[] = Array.from({ length: CURRENT_MONTH_SHARD_COUNT }, (_, bucket) =>
    CurrentMonthShard.parse({
      schema_version: CURRENT_MONTH_SCHEMA_VERSION,
      bucket,
      per_repo: {},
      current_stars: {},
    }),
  );

  for (const [id, series] of Object.entries(parsed.per_repo)) {
    buckets[repoShard(Number(id))].per_repo[id] = series;
  }
  for (const [id, stars] of Object.entries(parsed.current_stars)) {
    buckets[repoShard(Number(id))].current_stars[id] = stars;
  }

  return {
    index: CurrentMonthIndex.parse({
      schema_version: CURRENT_MONTH_SCHEMA_VERSION,
      month: parsed.month,
      updated: parsed.updated,
      daily_totals: parsed.daily_totals,
      shard_count: CURRENT_MONTH_SHARD_COUNT,
    }),
    shards: buckets.map((data) => ({ path: currentMonthShardPath(data.bucket), data })),
  };
}

export function assembleCurrentMonth(
  index: CurrentMonthIndexData,
  shards: readonly CurrentMonthShardData[],
): CurrentMonthData {
  const parsedIndex = CurrentMonthIndex.parse(index);
  if (shards.length !== parsedIndex.shard_count) {
    throw new Error(`current_month expected ${parsedIndex.shard_count} shards, received ${shards.length}`);
  }
  const perRepo: CurrentMonthData["per_repo"] = {};
  const currentStars: CurrentMonthData["current_stars"] = {};
  const seen = new Set<number>();
  for (const shard of shards) {
    const parsed = CurrentMonthShard.parse(shard);
    if (seen.has(parsed.bucket)) throw new Error(`current_month duplicate shard bucket ${parsed.bucket}`);
    seen.add(parsed.bucket);
    Object.assign(perRepo, parsed.per_repo);
    Object.assign(currentStars, parsed.current_stars);
  }
  if (seen.size !== parsedIndex.shard_count) {
    const missing = Array.from({ length: parsedIndex.shard_count }, (_, bucket) => bucket).filter((bucket) => !seen.has(bucket));
    throw new Error(`current_month missing shard bucket(s) ${missing.join(",")}`);
  }
  return CurrentMonth.parse({
    month: parsedIndex.month,
    updated: parsedIndex.updated,
    daily_totals: parsedIndex.daily_totals,
    per_repo: perRepo,
    current_stars: currentStars,
  });
}

export function currentMonthPublicationArtifacts(month: CurrentMonthData): Array<{ path: string; data: unknown }> {
  const { index, shards } = splitCurrentMonth(month);
  return [{ path: CURRENT_MONTH_INDEX_PATH, data: index }, ...shards];
}
