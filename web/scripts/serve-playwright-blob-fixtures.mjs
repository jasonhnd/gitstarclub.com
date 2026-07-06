import { createServer } from "node:http";

const GENERATED_AT = "2026-06-24T00:00:00.000Z";
const DATA_DATE = "2026-06-24";
const VERSION = "playwright";

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const port = Number(optionValue("--port", "3101"));

const repos = [
  repoSeed(1, "react", "react", "JavaScript", 238_000),
  repoSeed(2, "vuejs", "vue", "TypeScript", 210_000),
  repoSeed(3, "vercel", "next.js", "JavaScript", 132_000),
  repoSeed(4, "nuxt", "nuxt", "TypeScript", 58_000),
  repoSeed(5, "facebook", "react-native", "TypeScript", 122_000),
  repoSeed(6, "flutter", "flutter", "Dart", 169_000),
];

const orgs = [
  orgSeed("react", [1]),
  orgSeed("vuejs", [2]),
  orgSeed("vercel", [3]),
  orgSeed("nuxt", [4]),
  orgSeed("facebook", [5]),
  orgSeed("flutter", [6]),
];

const staticViews = new Map([
  ["views/latest.json", { version: VERSION, run_id: VERSION, published_at: GENERATED_AT }],
  ["hot-snapshot.json", hotSnapshot()],
  ["current_month.json", currentMonth()],
  ["meta.json", meta()],
  ["lookup/repos.json", reposLookup()],
  ["lookup/orgs.json", orgsLookup()],
  ["lookup/aliases.json", {}],
  ["lookup/categories.json", categoriesLookup()],
  ["search/index.json", searchIndex()],
  ["categories/registry.json", categoryRegistry()],
  ["categories/assignments.json", categoryAssignments()],
  ["rank/all-time/repo/stock.json", rankList("all", "all", "repo", "stock", repos.map((repo, index) => rankRepo(repo, index, repo.current_stars)))],
  ["rank/all-time/org/stock.json", rankList("all", "all", "org", "stock", orgs.map((org, index) => rankOrg(org, index, org.current_stars_sum)))],
]);

for (const repo of repos) {
  staticViews.set(`entity/repo/${repo.id}.json`, repoEntity(repo));
}

for (const org of orgs) {
  staticViews.set(`entity/org/${org.login}.json`, orgEntity(org));
}

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (path === "__health") {
      text(res, 200, "ok");
      return;
    }

    const payload = resolveView(path);
    if (payload === undefined) {
      json(res, 404, { error: "not found", path });
      return;
    }

    json(res, 200, payload);
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : "fixture server error" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Playwright Blob fixtures listening on http://127.0.0.1:${port}`);
});

function resolveView(path) {
  const rel = path.startsWith(`views/${VERSION}/`) ? path.slice(`views/${VERSION}/`.length) : path;
  const weekMatch = /^rank\/week\/([^/]+)\/repo\/flow\.json$/.exec(rel);
  if (weekMatch) {
    return rankList("week", weekMatch[1], "repo", "flow", repos.map((repo, index) => rankRepo(repo, index, 1_600 - index * 110)));
  }

  return staticViews.get(rel);
}

function repoSeed(id, owner, name, language, currentStars) {
  return {
    id,
    owner,
    name,
    full_name: `${owner}/${name}`,
    owner_type: "Organization",
    language,
    current_stars: currentStars,
    description: `${name} deterministic Playwright fixture`,
  };
}

function orgSeed(login, memberIds) {
  const members = memberIds.map((id) => repos.find((repo) => repo.id === id)).filter(Boolean);
  return {
    login,
    owner_type: "Organization",
    repo_count: members.length,
    current_stars_sum: members.reduce((sum, repo) => sum + repo.current_stars, 0),
    members: memberIds,
  };
}

function meta() {
  return {
    seam_date: "2024-01-01",
    schema_ver: 1,
    generated_at: GENERATED_AT,
    folded_through: { month: "2099-01", week: "2099-W01" },
  };
}

function reposLookup() {
  return Object.fromEntries(
    repos.map((repo) => [
      String(repo.id),
      {
        owner: repo.owner,
        name: repo.name,
        full_name: repo.full_name,
        owner_type: repo.owner_type,
        language: repo.language,
        current_stars: repo.current_stars,
      },
    ]),
  );
}

function orgsLookup() {
  return Object.fromEntries(
    orgs.map((org) => [
      org.login,
      {
        login: org.login,
        owner_type: org.owner_type,
        repo_count: org.repo_count,
        current_stars_sum: org.current_stars_sum,
      },
    ]),
  );
}

function searchIndex() {
  return {
    generated_at: GENERATED_AT,
    count: repos.length,
    repos: repos.map((repo) => ({
      id: repo.id,
      full_name: repo.full_name,
      owner: repo.owner,
      language: repo.language,
      current_stars: repo.current_stars,
      description: repo.description,
    })),
  };
}

function categoryRegistry() {
  return {
    rules_version: "playwright",
    generated_at: GENERATED_AT,
    dimensions: [
      {
        id: "language",
        label: "Language",
        categories: [
          category("language/javascript", "language", "javascript", "JavaScript", 2),
          category("language/typescript", "language", "typescript", "TypeScript", 3),
          category("language/dart", "language", "dart", "Dart", 1),
        ],
      },
      {
        id: "project_type",
        label: "Project type",
        categories: [category("project_type/framework", "project_type", "framework", "Framework", repos.length)],
      },
    ],
  };
}

function categoriesLookup() {
  const registry = categoryRegistry();
  return {
    rules_version: registry.rules_version,
    generated_at: registry.generated_at,
    dimensions: registry.dimensions.map((dimension) => ({
      id: dimension.id,
      label: dimension.label,
      categories: dimension.categories.map(({ id, slug, label, count, sitemap }) => ({ id, slug, label, count, sitemap })),
    })),
  };
}

function category(id, dimension, slug, label, count) {
  return {
    id,
    dimension,
    slug,
    label,
    count,
    public: true,
    sitemap: true,
    minimum_repo_count: 1,
  };
}

function categoryAssignments() {
  return {
    rules_version: "playwright",
    generated_at: GENERATED_AT,
    repositories: Object.fromEntries(
      repos.map((repo) => [
        String(repo.id),
        {
          language: [`language/${slug(repo.language)}`],
          language_family: [],
          domain: [],
          project_type: ["project_type/framework"],
          ecosystem: [],
          owner_kind: ["owner_kind/organization"],
          maturity: [],
        },
      ]),
    ),
  };
}

function hotSnapshot() {
  return {
    generated_at: GENERATED_AT,
    home: {
      year_spine: [
        ["2024", 10_000],
        ["2025", 25_000],
        ["2026", 45_000],
      ],
      current_month_top: {
        flow: repos.map((repo, index) => rankRepo(repo, index, 900 - index * 70)),
        stock: repos.map((repo, index) => rankRepo(repo, index, repo.current_stars)),
      },
      on_this_day: [{ id: 1, crossed: "100k", date: DATA_DATE }],
    },
    current_year: {
      flow: repos.map((repo, index) => rankRepo(repo, index, 6_000 - index * 420)),
      stock: repos.map((repo, index) => rankRepo(repo, index, repo.current_stars)),
    },
    current_month: {
      flow: repos.map((repo, index) => rankRepo(repo, index, 900 - index * 70)),
      stock: repos.map((repo, index) => rankRepo(repo, index, repo.current_stars)),
    },
    all_time: {
      repo: repos.map((repo, index) => rankRepo(repo, index, repo.current_stars)),
      org: orgs.map((org, index) => rankOrg(org, index, org.current_stars_sum)),
    },
  };
}

function currentMonth() {
  return {
    month: "2026-06",
    updated: DATA_DATE,
    daily_totals: [[DATA_DATE, 900]],
    per_repo: Object.fromEntries(repos.map((repo, index) => [String(repo.id), [[DATA_DATE, 150 - index * 10]]])),
    current_stars: Object.fromEntries(repos.map((repo) => [String(repo.id), repo.current_stars])),
  };
}

function rankList(window, period, dim, metric, items) {
  return {
    meta: { window, period, dim, metric, generated_at: GENERATED_AT },
    items,
  };
}

function rankRepo(repo, index, value) {
  return { rank: index + 1, id: repo.id, value, prev_rank: index === 0 ? null : index };
}

function rankOrg(org, index, value) {
  return { rank: index + 1, login: org.login, value, prev_rank: index === 0 ? null : index };
}

function repoEntity(repo) {
  const monthly = monthlySeries(repo.current_stars);
  return {
    id: repo.id,
    full_name: repo.full_name,
    owner: repo.owner,
    owner_type: repo.owner_type,
    name: repo.name,
    description: repo.description,
    language: repo.language,
    languages: [{ name: repo.language, size: 100_000, color: "#3178c6" }],
    topics: ["fixture", "playwright"],
    homepage_url: "",
    license: "MIT",
    latest_release: null,
    created_at: "2014-01-01",
    current_stars: repo.current_stars,
    is_archived: false,
    milestones: {
      crossed_10k: "2024-01-15",
      crossed_50k: "2025-01-15",
      crossed_100k: repo.current_stars >= 100_000 ? "2026-01-15" : null,
    },
    curve: {
      monthly,
      recent_daily: [[DATA_DATE, 128]],
    },
    monthly_table: monthly.map(([month, adds]) => ({ month, adds, rank: 1 })),
    rank_history: {
      all: monthly.map(([month], index) => [month, index + 1]),
    },
    inflections: [{ period: "2025-01", flow: 12_000, kind: "surge" }],
  };
}

function orgEntity(org) {
  const monthly = monthlySeries(org.current_stars_sum);
  return {
    login: org.login,
    owner_type: org.owner_type,
    current_stars_sum: org.current_stars_sum,
    repo_count: org.repo_count,
    members: org.members,
    curve: {
      monthly,
      recent_daily: [[DATA_DATE, 96]],
    },
    rank_history: {
      all: monthly.map(([month], index) => [month, index + 1]),
    },
  };
}

function monthlySeries(currentStars) {
  return [
    ["2024-01", 10_000, 10_000],
    ["2025-01", 40_000, Math.min(50_000, currentStars)],
    ["2026-01", 35_000, Math.min(100_000, currentStars)],
    ["2026-06", Math.max(1_000, currentStars - 100_000), currentStars],
  ];
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function json(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function text(res, status, payload) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}
