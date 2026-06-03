import { cache } from "react";
import { RepoEntity, type CompareCurve } from "@/lib/contracts";
import { readView } from "./source";

// getRepoCurve(id): read the versioned repo entity (publish-pointer resolved) and project the lean
// CompareCurve payload the /compare overlay needs. Served to the browser CDN-cached via
// app/repo-curve/route.ts. No new Blob artifact — see docs/DATA-CONTRACTS.md §2.15.
export const getRepoCurve = cache(async (id: number): Promise<CompareCurve | null> => {
  const repo = await readView(`entity/repo/${id}.json`, RepoEntity, { base: true });
  if (!repo) return null;
  return {
    id: repo.id,
    full_name: repo.full_name,
    current_stars: repo.current_stars,
    crossed_10k: repo.milestones.crossed_10k,
    points: repo.curve.monthly.map(([period, , total]) => [period, total]),
  };
});
