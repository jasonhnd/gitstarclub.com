// Recompute orchestrator — assembles the full view matrix from a Model, the pure-JS
// replacement for pipeline/backfill/05-precompute.mjs. The offline parity harness runs
// computeAllViews(); workflow step drivers call the per-group helpers (computeRankViews,
// computeRepoEntityViews, …) so each Vercel step stays short. See VERCEL-DATA-OPERATIONS §3.

import type { Model } from "./model";
import { computeOrgWindow, computeRepoWindow, deriveYearWindow, type RepoWindow, type Window } from "./windows";
import { allTime, growth, newcomers, orgRankMatrix, repoRankMatrix, type RankView } from "./ranks";
import { lookups, orgEntities, repoEntities } from "./entities";
import { heatmaps } from "./heatmap";

export * from "./model";
export * from "./windows";

const WINDOWS: Window[] = ["month", "week", "year"];

export interface RecomputeOpts {
  gen: string;
  seamDate: string;
  foldedThrough: { month: string; week: string };
}

export interface ViewBundle {
  views: Map<string, unknown>;
  stats: { repos: number; orgs: number; repoAnchorDrift: number; orgAnchorDrift: number };
}

/** Rank matrix + all-time + growth + newcomers (cross-bucket; needs the full model). */
export function computeRankViews(model: Model, gen: string): Map<string, RankView> {
  const out = new Map<string, RankView>();
  const monthWin = computeRepoWindow(model, "month");
  const repoWindows: Record<Window, RepoWindow> = {
    month: monthWin,
    week: computeRepoWindow(model, "week"),
    year: deriveYearWindow(model, monthWin),
  };
  for (const w of WINDOWS) {
    const rw = repoWindows[w];
    for (const [k, v] of repoRankMatrix(rw, w, gen)) out.set(k, v);
    const ow = computeOrgWindow(model, rw);
    for (const [k, v] of orgRankMatrix(ow, w, gen)) out.set(k, v);
  }
  for (const [k, v] of allTime(model, gen)) out.set(k, v);
  for (const w of ["month", "year"] as const) {
    for (const [k, v] of growth(repoWindows[w], w, gen)) out.set(k, v);
    for (const [k, v] of newcomers(model, w, gen)) out.set(k, v);
  }
  return out;
}

/** Whole matrix in one pass — used by the parity harness and small-scale recompute. */
export function computeAllViews(model: Model, opts: RecomputeOpts): ViewBundle {
  const { gen } = opts;
  const views = new Map<string, unknown>();

  const monthWin = computeRepoWindow(model, "month");
  const monthOrg = computeOrgWindow(model, monthWin);
  const weekWin = computeRepoWindow(model, "week");
  const yearWin = deriveYearWindow(model, monthWin);

  for (const [w, rw] of [["month", monthWin], ["week", weekWin], ["year", yearWin]] as const) {
    for (const [k, v] of repoRankMatrix(rw, w, gen)) views.set(k, v);
    const ow = computeOrgWindow(model, rw);
    for (const [k, v] of orgRankMatrix(ow, w, gen)) views.set(k, v);
  }
  for (const [k, v] of allTime(model, gen)) views.set(k, v);
  for (const [k, v] of growth(monthWin, "month", gen)) views.set(k, v);
  for (const [k, v] of growth(yearWin, "year", gen)) views.set(k, v);
  for (const [k, v] of newcomers(model, "month", gen)) views.set(k, v);
  for (const [k, v] of newcomers(model, "year", gen)) views.set(k, v);

  for (const [k, v] of heatmaps(model.siteDaily, gen)) views.set(k, v);

  const repo = repoEntities(model, monthWin);
  for (const [k, v] of repo.views) views.set(k, v);
  const org = orgEntities(model, monthOrg);
  for (const [k, v] of org.views) views.set(k, v);
  for (const [k, v] of lookups(model)) views.set(k, v);

  views.set("meta.json", {
    seam_date: opts.seamDate,
    schema_ver: 1,
    folded_through: opts.foldedThrough,
    generated_at: gen,
  });

  return {
    views,
    stats: { repos: repo.views.size, orgs: org.views.size, repoAnchorDrift: repo.anchorDrift, orgAnchorDrift: org.anchorDrift },
  };
}

export { repoEntities, orgEntities, lookups, heatmaps };
