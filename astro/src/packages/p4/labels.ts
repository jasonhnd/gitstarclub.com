import type { Dict } from "../../../../web/lib/i18n";

export function repositoryTableLabels(t: Dict) {
  return {
    caption: t.tables.repositoryRankings,
    rank: t.tables.rank,
    repository: t.tables.repository,
    language: t.tables.language,
    unknown: t.tables.unknown,
    starsGained: t.tables.starsGained,
    growthRatePercent: t.tables.growthRatePercent,
    tenKCrossingDay: t.tables.tenKCrossingDay,
    day: t.tables.day,
    totalStars: t.tables.totalStars,
    rowStarsAdded: t.tables.rowStarsAdded,
  };
}

export function organizationTableLabels(t: Dict) {
  return {
    caption: t.tables.organizationRankings,
    rank: t.tables.rank,
    owner: t.tables.owner,
    ownerType: t.tables.ownerType,
    unknown: t.tables.unknown,
    trackedRepositories: t.tables.trackedRepositories,
    totalStars: t.tables.totalStars,
  };
}
