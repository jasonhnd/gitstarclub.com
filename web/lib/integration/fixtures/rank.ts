import type { RankList } from "@/lib/contracts";

type RankFixtureValues = {
  generatedAt: string;
  repoId: number;
  orgLogin: string;
  stock: number;
  flow: number;
  orgValue: number;
  growth?: { value: number; rate: number; base: number };
  newcomer?: { value: number; date: string };
};

// Values belong to each suite; this builder has no availability or global state.
export function createRankFixture(values: RankFixtureValues) {
  return (window: string, period: string, dim: string, metric: string): RankList => {
    const repoItem = {
      rank: 1,
      id: values.repoId,
      value: metric === "stock" ? values.stock : values.flow,
      prev_rank: null,
    };
    const item = metric === "growth" && values.growth
      ? { ...repoItem, ...values.growth }
      : metric === "new" && values.newcomer
        ? { ...repoItem, ...values.newcomer }
        : repoItem;

    return {
      meta: {
        window: window as RankList["meta"]["window"],
        period: period as RankList["meta"]["period"],
        dim: dim as RankList["meta"]["dim"],
        metric: metric as RankList["meta"]["metric"],
        generated_at: values.generatedAt,
      },
      items: [dim === "repo"
        ? item
        : { rank: 1, login: values.orgLogin, value: values.orgValue, prev_rank: null }],
    };
  };
}
