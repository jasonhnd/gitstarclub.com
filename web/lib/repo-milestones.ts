type RepoMilestones = {
  crossed_10k?: string | null;
  crossed_50k?: string | null;
  crossed_100k?: string | null;
};

export type ExactRepoMilestone = {
  stars: number;
  label: string;
  date: string;
  monthIndex: number;
};

const EXACT_MILESTONES: Array<{ key: keyof RepoMilestones; stars: number; label: string }> = [
  { key: "crossed_10k", stars: 10_000, label: "10k" },
  { key: "crossed_50k", stars: 50_000, label: "50k" },
  { key: "crossed_100k", stars: 100_000, label: "100k" },
];

export function exactRepoMilestones(
  series: Array<{ label: string }>,
  milestones: RepoMilestones | null | undefined,
): ExactRepoMilestone[] {
  if (!milestones) return [];
  return EXACT_MILESTONES.flatMap(({ key, stars, label }) => {
    const date = milestones[key];
    if (!date) return [];
    const monthIndex = series.findIndex((point) => point.label === date.slice(0, 7));
    if (monthIndex < 0) return [];
    return [{ stars, label, date, monthIndex }];
  });
}
