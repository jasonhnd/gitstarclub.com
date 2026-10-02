import type {
  CategoryAssignments,
  CategoryRankList,
  CategoryRegistry,
  CompareCurve,
  HotSnapshot,
  Meta,
  OrgEntity,
  OrgsLookup,
  RepoEntity,
  ReposLookup,
} from "@/lib/contracts";
import { createRankFixture } from "./rank";

export const GENERATED_AT = "2026-06-04T12:00:00.000Z";
export const REPO_ID = 1;
export const REPO_FULL_NAME = "vuejs/vue";
export const REPO_OWNER = "vuejs";
export const REPO_NAME = "vue";
export const ORG_LOGIN = "microsoft";
export const RANKING_YEAR = "2024";
export const RANKING_MONTH = "6";
export const RANKING_WEEK = "W10";
export const CATEGORY_DIMENSION = "language";
export const CATEGORY_SLUG = "python";

export const rankFixture = createRankFixture({
  generatedAt: GENERATED_AT,
  repoId: REPO_ID,
  orgLogin: ORG_LOGIN,
  stock: 210_000,
  flow: 1_200,
  orgValue: 220_000,
  growth: { value: 15, rate: 1.5, base: 200_000 },
  newcomer: { value: 10_000, date: "2024-06-01" },
});

export function categoryRankFixture(dimension: string, slug: string): CategoryRankList {
  return {
    meta: {
      window: "all",
      period: "all",
      dim: "repo",
      metric: "stock",
      generated_at: GENERATED_AT,
      category: {
        id: `${dimension}/${slug}` as CategoryRankList["meta"]["category"]["id"],
        dimension: dimension as CategoryRankList["meta"]["category"]["dimension"],
        slug,
      },
    },
    items: [{ rank: 1, id: REPO_ID, value: 210_000, prev_rank: null }],
  };
}

export function heatmapFixture(scope: string, period: string) {
  return {
    meta: {
      scope,
      period,
      generated_at: GENERATED_AT,
    },
    cells: scope === "year" ? [[`${period}-01`, 1_200]] : [[`${period}-01`, 40]],
  };
}

type RepoRankItem = {
  id: number;
  value: number;
  rank?: number | null;
  prev_rank?: number | null;
  rate?: number;
  base?: number;
  date?: string;
};

type OrgRankItem = {
  login: string;
  value: number;
  rank?: number | null;
  prev_rank?: number | null;
};

export function repoIdByFullNameFixture(): Map<string, number> {
  return new Map([[REPO_FULL_NAME.toLowerCase(), REPO_ID]]);
}

export function joinRepoRank(items: readonly RepoRankItem[], lookup: ReposLookup) {
  return items.flatMap((item) => {
    const repo = lookup[String(item.id)];
    return repo ? [{ ...item, ...repo }] : [];
  });
}

export function joinOrgRank(items: readonly OrgRankItem[], lookup: OrgsLookup) {
  return items.flatMap((item) => {
    const org = lookup[item.login];
    return org ? [{ ...item, ...org }] : [];
  });
}

export const metaFixture: Meta = {
  seam_date: "2026-06-01",
  schema_ver: 1,
  generated_at: GENERATED_AT,
  folded_through: { month: "2026-06", week: "2026-W23" },
};

export const reposLookupFixture: ReposLookup = {
  [String(REPO_ID)]: {
    owner: REPO_OWNER,
    name: REPO_NAME,
    full_name: REPO_FULL_NAME,
    owner_type: "Organization",
    language: "JavaScript",
    current_stars: 210_000,
  },
};

export const orgsLookupFixture: OrgsLookup = {
  [ORG_LOGIN]: {
    login: ORG_LOGIN,
    owner_type: "Organization",
    repo_count: 1,
    current_stars_sum: 220_000,
  },
};

export const repoEntityFixture: RepoEntity = {
  id: REPO_ID,
  full_name: REPO_FULL_NAME,
  owner: REPO_OWNER,
  owner_type: "Organization",
  name: REPO_NAME,
  description: "The progressive JavaScript framework.",
  language: "JavaScript",
  languages: [{ name: "JavaScript", size: 1000, color: "#f1e05a" }],
  topics: ["frontend"],
  homepage_url: "https://vuejs.org",
  license: "MIT",
  latest_release: {
    name: "Vue 3",
    tag_name: "v3.0.0",
    published_at: "2024-01-01",
    url: "https://github.com/vuejs/core/releases/tag/v3.0.0",
  },
  created_at: "2013-07-29",
  current_stars: 210_000,
  is_archived: false,
  milestones: {
    crossed_10k: "2015-01-01",
    crossed_50k: "2017-01-01",
    crossed_100k: "2018-01-01",
  },
  curve: {
    monthly: [
      ["2014-01", 5_000, 5_000],
      ["2015-01", 6_000, 11_000],
      ["2017-01", 40_000, 51_000],
      ["2018-01", 55_000, 106_000],
      ["2026-06", 1_200, 210_000],
    ],
    recent_daily: [["2026-06-04", 40]],
  },
  monthly_table: [{ month: "2026-06", adds: 1_200, rank: 1 }],
  rank_history: { month: [["2026-06", 1]] },
  inflections: [],
};

export const repoCurveFixture: CompareCurve = {
  id: REPO_ID,
  full_name: REPO_FULL_NAME,
  current_stars: repoEntityFixture.current_stars,
  crossed_10k: repoEntityFixture.milestones.crossed_10k,
  points: repoEntityFixture.curve.monthly.map(([period, , total]) => [period, total]),
};

export const orgEntityFixture: OrgEntity = {
  login: ORG_LOGIN,
  owner_type: "Organization",
  current_stars_sum: 220_000,
  repo_count: 1,
  members: [REPO_ID],
  curve: {
    monthly: [
      ["2024-01", 5_000, 100_000],
      ["2026-06", 1_200, 220_000],
    ],
    recent_daily: [["2026-06-04", 40]],
  },
  rank_history: {},
};

export const categoryRegistryFixture: CategoryRegistry = {
  rules_version: "uiux-seo",
  generated_at: GENERATED_AT,
  dimensions: [
    {
      id: CATEGORY_DIMENSION,
      label: "Language",
      categories: [
        {
          id: `${CATEGORY_DIMENSION}/${CATEGORY_SLUG}`,
          dimension: CATEGORY_DIMENSION,
          slug: CATEGORY_SLUG,
          label: "Python",
          count: 1,
          public: true,
          sitemap: true,
          minimum_repo_count: 1,
        },
      ],
    },
  ],
};

export const categoryAssignmentsFixture: CategoryAssignments = {
  rules_version: "uiux-seo",
  generated_at: GENERATED_AT,
  repositories: {
    [String(REPO_ID)]: {
      language: [`${CATEGORY_DIMENSION}/${CATEGORY_SLUG}`],
      language_family: [],
      domain: [],
      project_type: [],
      ecosystem: [],
      owner_kind: ["owner_kind/organization"],
      maturity: [],
    },
  },
};

export const hotSnapshotFixture: HotSnapshot = {
  generated_at: GENERATED_AT,
  home: {
    year_spine: [[RANKING_YEAR, 1_200]],
    current_month_top: {
      flow: [{ rank: 1, id: REPO_ID, value: 1_200, prev_rank: null }],
      stock: [{ rank: 1, id: REPO_ID, value: 210_000, prev_rank: null }],
    },
    on_this_day: [{ id: REPO_ID, crossed: "10k", date: "2015-01-01" }],
  },
  current_year: {
    flow: [{ rank: 1, id: REPO_ID, value: 1_200, prev_rank: null }],
    stock: [{ rank: 1, id: REPO_ID, value: 210_000, prev_rank: null }],
  },
  current_month: {
    flow: [{ rank: 1, id: REPO_ID, value: 1_200, prev_rank: null }],
    stock: [{ rank: 1, id: REPO_ID, value: 210_000, prev_rank: null }],
  },
  all_time: {
    repo: [{ rank: 1, id: REPO_ID, value: 210_000, prev_rank: null }],
    org: [{ rank: 1, login: ORG_LOGIN, value: 220_000, prev_rank: null }],
  },
};

export function emptyRepoEntityFixture(): RepoEntity {
  return {
    ...repoEntityFixture,
    description: null,
    language: null,
    languages: [],
    topics: [],
    homepage_url: null,
    license: null,
    latest_release: null,
    monthly_table: [],
    rank_history: { month: [] },
  };
}

export function emptyOrgEntityFixture(): OrgEntity {
  return {
    ...orgEntityFixture,
    current_stars_sum: 0,
    repo_count: 0,
    members: [],
    curve: {
      monthly: [],
      recent_daily: [],
    },
  };
}

export function emptyCategoryRegistryFixture(): CategoryRegistry {
  return {
    ...categoryRegistryFixture,
    dimensions: categoryRegistryFixture.dimensions.map((dimension) => ({ ...dimension, categories: [] })),
  };
}

export function emptyCategoryAssignmentsFixture(): CategoryAssignments {
  return {
    ...categoryAssignmentsFixture,
    repositories: {},
  };
}

export function emptyHotSnapshotFixture(): HotSnapshot {
  return {
    ...hotSnapshotFixture,
    home: {
      ...hotSnapshotFixture.home,
      current_month_top: { flow: [], stock: [] },
      on_this_day: [],
    },
    current_year: { flow: [], stock: [] },
    current_month: { flow: [], stock: [] },
    all_time: { repo: [], org: [] },
  };
}
