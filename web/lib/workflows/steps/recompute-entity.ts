import { clearViewParseMemo } from "@/lib/data/parse-view";
import { REPO_BUCKETS } from "../buckets";
import {
  ENTITY_WRITE_CHUNK,
  loadFullReposBucket,
  loadPackedRepoWindow,
  loadRecentDailyBucket,
  writeVersion,
} from "../recompute/io";
import { orgEntityFromParts, repoEntityFromParts } from "../recompute/entities";
import {
  assignPackedFlowRanks,
  packedOrgPeriodRows,
  packedRepoRows,
} from "../recompute/packed-window";
import type { DailySeries, DateStr, OwnerType } from "../recompute/model";
import type { OrgRow } from "../recompute/windows";

// Steps 7a/7b — entity recompute. Repo flow_rank is cross-bucket, so the month
// window is packed once (prefer the persist from the rank hops) then entities
// are written one repo-bucket at a time. Org entities walk the packed window
// period-by-period and do not keep monthly JSON + object windows together.
// Lookups / all-time / search are written by the rest rank hop from one repos
// load so validate sees a consistent stock snapshot.
// See docs/VERCEL-DATA-OPERATIONS.md §3.1 / §3.3.

type OrgAcc = {
  login: string;
  owner_type: OwnerType;
  repo_count: number;
  current_stars_sum: number;
  members: number[];
};

export async function recomputeRepoEntities(runId: string, fencingToken: number): Promise<{ files: number; anchorDrift: number }> {
  const owner = { runId, fencingToken };
  const { packed } = await loadPackedRepoWindow(runId, "month", { owner, persist: true });
  const flowRank = assignPackedFlowRanks(packed);
  const byId = new Map(packed.ids.map((id, index) => [id, index]));
  let files = 0;
  let anchorDrift = 0;
  const batch = new Map<string, unknown>();
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    const repos = await loadFullReposBucket(runId, bucket);
    const daily = await loadRecentDailyBucket(runId, bucket);
    for (const [id, meta] of repos) {
      const idx = byId.get(id);
      const mrows = idx === undefined ? [] : packedRepoRows(packed, idx, flowRank);
      const built = repoEntityFromParts(meta, mrows, daily.get(id) ?? []);
      anchorDrift = Math.max(anchorDrift, built.drift);
      batch.set(`entity/repo/${id}.json`, built.entity);
      if (batch.size >= ENTITY_WRITE_CHUNK) {
        files += await writeVersion(runId, batch, owner);
        batch.clear();
      }
    }
    repos.clear();
    daily.clear();
    clearViewParseMemo();
  }
  if (batch.size > 0) files += await writeVersion(runId, batch, owner);
  return { files, anchorDrift };
}

export async function recomputeOrgEntities(runId: string, fencingToken: number): Promise<{ files: number; anchorDrift: number }> {
  const owner = { runId, fencingToken };
  const { packed } = await loadPackedRepoWindow(runId, "month", { owner, persist: true });
  const orgs = new Map<string, OrgAcc>();
  const ownerOf = new Map<number, string>();
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    const repos = await loadFullReposBucket(runId, bucket);
    for (const [id, meta] of repos) {
      ownerOf.set(id, meta.owner);
      if (meta.active === false) continue;
      let acc = orgs.get(meta.owner);
      if (!acc) {
        acc = {
          login: meta.owner,
          owner_type: meta.owner_type,
          repo_count: 0,
          current_stars_sum: 0,
          members: [],
        };
        orgs.set(meta.owner, acc);
      }
      acc.repo_count += 1;
      acc.current_stars_sum += meta.current_stars;
      acc.members.push(id);
    }
    repos.clear();
    clearViewParseMemo();
  }
  for (const acc of orgs.values()) acc.members.sort((left, right) => left - right);

  const orgDaily = new Map<string, Map<DateStr, number>>();
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    const daily = await loadRecentDailyBucket(runId, bucket);
    for (const [id, series] of daily) {
      const login = ownerOf.get(id);
      if (!login || !orgs.has(login)) continue;
      let days = orgDaily.get(login);
      if (!days) orgDaily.set(login, (days = new Map()));
      for (const cell of series as DailySeries) {
        days.set(cell[0], (days.get(cell[0]) ?? 0) + cell[1]);
      }
    }
    daily.clear();
    clearViewParseMemo();
  }

  const byLogin = new Map<string, OrgRow[]>();
  const carry = new Float64Array(packed.ids.length);
  for (let periodIndex = 0; periodIndex < packed.periods.length; periodIndex++) {
    const rows = packedOrgPeriodRows(packed, periodIndex, carry, { activeOnly: true });
    const period = packed.periods[periodIndex]!;
    for (const row of rows) {
      let list = byLogin.get(row.login);
      if (!list) byLogin.set(row.login, (list = []));
      list.push({ period, flow: row.flow, stock_est: row.stock_est });
    }
  }

  let files = 0;
  let anchorDrift = 0;
  const batch = new Map<string, unknown>();
  for (const [login, acc] of orgs) {
    const days = orgDaily.get(login);
    const recentDaily = days
      ? [...days.entries()].sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
      : [];
    const built = orgEntityFromParts(
      login,
      acc.owner_type,
      acc.current_stars_sum,
      acc.repo_count,
      acc.members,
      byLogin.get(login) ?? [],
      recentDaily,
    );
    anchorDrift = Math.max(anchorDrift, built.drift);
    batch.set(`entity/org/${login}.json`, built.entity);
    if (batch.size >= ENTITY_WRITE_CHUNK) {
      files += await writeVersion(runId, batch, owner);
      batch.clear();
    }
  }
  if (batch.size > 0) files += await writeVersion(runId, batch, owner);
  return { files, anchorDrift };
}
