// Placeholder data for the M3E UI/UX exploration. Plausible, not real —
// the data layer isn't built yet. Numbers are "stars gained" in millions
// for display weighting only.

export type YearRow = {
  year: number;
  gained: number; // relative magnitude for bar width
  caption: string; // editorial chronicle label
  peak?: boolean;
};

export type RepoRow = {
  owner: string;
  name: string;
  lang: string;
  gained: number; // stars gained in the period (absolute, for display)
  total: number; // current total stars
};

export const YEARS: ReadonlyArray<YearRow> = [
  { year: 2015, gained: 2.1, caption: "The container era — Docker & Kubernetes rising" },
  { year: 2016, gained: 2.8, caption: "Frameworks bloom — React & Vue ascendant" },
  { year: 2017, gained: 3.4, caption: "Deep learning goes mainstream — TensorFlow, PyTorch" },
  { year: 2018, gained: 4.0, caption: "The TypeScript turn" },
  { year: 2019, gained: 4.6, caption: "Cloud-native consolidates" },
  { year: 2020, gained: 6.2, caption: "Lockdown builds — remote tooling surges" },
  { year: 2021, gained: 7.1, caption: "The creator stack" },
  { year: 2022, gained: 6.8, caption: "Generative stirrings — Stable Diffusion drops" },
  { year: 2023, gained: 9.4, caption: "The LLM gold rush — LangChain, llama.cpp" },
  { year: 2024, gained: 12.3, caption: "AI year zero — Ollama & open models everywhere", peak: true },
  { year: 2025, gained: 10.8, caption: "Agents take the stage" },
  { year: 2026, gained: 5.2, caption: "In progress" },
];

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Deterministic per-year monthly distribution (12 values), so the heatmap is
// stable across renders without real data.
export function monthsForYear(year: number): { label: string; gained: number }[] {
  const base = YEARS.find((y) => y.year === year)?.gained ?? 4;
  return MONTH_LABELS.map((label, i) => {
    // pseudo-random but deterministic wave + a couple of spikes
    const wave = 0.55 + 0.45 * Math.sin((i + year) * 1.3);
    const spike = (i === 2 || i === 9) ? 1.35 : 1;
    return { label, gained: +(base * wave * spike).toFixed(1) };
  });
}

const TOP_2024: ReadonlyArray<RepoRow> = [
  { owner: "ollama", name: "ollama", lang: "Go", gained: 78400, total: 142000 },
  { owner: "langchain-ai", name: "langchain", lang: "Python", gained: 61200, total: 98700 },
  { owner: "comfyanonymous", name: "ComfyUI", lang: "Python", gained: 54800, total: 71300 },
  { owner: "ggerganov", name: "llama.cpp", lang: "C++", gained: 49100, total: 69500 },
  { owner: "open-webui", name: "open-webui", lang: "Svelte", gained: 47600, total: 58200 },
  { owner: "danny-avila", name: "LibreChat", lang: "TypeScript", gained: 33200, total: 41800 },
  { owner: "lobehub", name: "lobe-chat", lang: "TypeScript", gained: 31900, total: 49200 },
  { owner: "infiniflow", name: "ragflow", lang: "Python", gained: 28700, total: 32100 },
];

export function topReposForYear(year: number): RepoRow[] {
  // single placeholder set, slightly scaled per year so pages differ
  const k = (YEARS.find((y) => y.year === year)?.gained ?? 8) / 12.3;
  return TOP_2024.map((r) => ({
    ...r,
    gained: Math.round(r.gained * k),
  }));
}

export function fmtK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export const FIRST_YEAR = YEARS[0].year;
export const LAST_YEAR = YEARS[YEARS.length - 1].year;
export const MAX_YEAR_GAINED = Math.max(...YEARS.map((y) => y.gained));

// repos that have a detail page (placeholder universe)
export const REPOS = TOP_2024;

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pseudo(...seed: number[]): number {
  // deterministic 0..1 from integer seeds
  const x = Math.sin(seed.reduce((a, b, i) => a + b * (i + 7) * 13.37, 1.23)) * 43758.5453;
  return x - Math.floor(x);
}

// daily total stars gained across the tracked universe, for the month heatmap
export function dailyForMonth(year: number, month: number): number[] {
  const days = new Date(year, month, 0).getDate();
  const base = (YEARS.find((y) => y.year === year)?.gained ?? 4) * 8000;
  return Array.from({ length: days }, (_, d) => {
    const wave = 0.45 + 0.5 * Math.sin((d + month * 2 + year) * 0.7);
    const spike = pseudo(year, month, d) > 0.9 ? 2.1 : 1;
    return Math.round(base * wave * spike);
  });
}

export type GrowthRow = RepoRow & { rate: number };
export type NewcomerRow = RepoRow & { crossedDay: number };

export interface MonthRankings {
  topNew: RepoRow[];
  topGrowth: GrowthRow[];
  newcomers: NewcomerRow[];
  totalGained: number;
  newcomerCount: number;
}

const NEWCOMER_POOL: ReadonlyArray<Omit<RepoRow, "gained">> = [
  { owner: "browser-use", name: "browser-use", lang: "Python", total: 11200 },
  { owner: "mendableai", name: "firecrawl", lang: "TypeScript", total: 13800 },
  { owner: "exo-explore", name: "exo", lang: "Python", total: 10400 },
  { owner: "kortix-ai", name: "suna", lang: "TypeScript", total: 10900 },
  { owner: "midday-ai", name: "midday", lang: "TypeScript", total: 12100 },
];

export function monthRankings(year: number, month: number): MonthRankings {
  const k = ((YEARS.find((y) => y.year === year)?.gained ?? 8) / 12.3) / 12;
  const scaled = TOP_2024.map((r) => ({
    ...r,
    gained: Math.max(120, Math.round(r.gained * k * (0.6 + pseudo(year, month, r.name.length)))),
  }));

  const topNew = [...scaled].sort((a, b) => b.gained - a.gained).slice(0, 8);

  const topGrowth: GrowthRow[] = scaled
    .filter((r) => r.total >= 20000) // floor: only repos already at scale still accelerating
    .map((r) => ({ ...r, rate: +((r.gained / r.total) * 100).toFixed(1) }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 6);

  const newcomers: NewcomerRow[] = NEWCOMER_POOL.map((r, i) => ({
    ...r,
    gained: Math.round(1000 + pseudo(year, month, i) * 1800),
    crossedDay: 1 + Math.floor(pseudo(month, year, i) * 27),
  })).slice(0, 5);

  return {
    topNew,
    topGrowth,
    newcomers,
    totalGained: dailyForMonth(year, month).reduce((a, b) => a + b, 0),
    newcomerCount: newcomers.length,
  };
}

// ===== Repo detail =====
export interface Milestone {
  stars: number;
  label: string;
  monthIndex: number;
  date: string;
}
export interface MonthlyRow {
  month: string; // 'YYYY-MM'
  gained: number;
  rank: number;
}
export interface RepoDetail {
  owner: string;
  name: string;
  lang: string;
  description: string;
  total: number;
  createdAt: string;
  topics: string[];
  series: { label: string; total: number }[];
  milestones: Milestone[];
  monthly: MonthlyRow[];
}

const DESCRIPTIONS: Record<string, { desc: string; topics: string[]; born: string }> = {
  ollama: { desc: "Get up and running with large language models locally.", topics: ["llm", "go", "local-ai"], born: "2023-06" },
  langchain: { desc: "Build context-aware reasoning applications.", topics: ["llm", "agents", "python"], born: "2022-10" },
  ComfyUI: { desc: "The most powerful node-based UI for diffusion models.", topics: ["stable-diffusion", "ui"], born: "2023-01" },
  "llama.cpp": { desc: "LLM inference in C/C++.", topics: ["llm", "inference", "cpp"], born: "2023-03" },
  "open-webui": { desc: "User-friendly AI interface (formerly Ollama WebUI).", topics: ["llm", "svelte", "ui"], born: "2023-10" },
  LibreChat: { desc: "Enhanced ChatGPT clone with many model providers.", topics: ["chat", "llm"], born: "2023-02" },
  "lobe-chat": { desc: "Modern open-source ChatGPT/LLM UI framework.", topics: ["chat", "nextjs"], born: "2023-05" },
  ragflow: { desc: "RAG engine based on deep document understanding.", topics: ["rag", "llm"], born: "2023-12" },
};

function monthsBetween(bornYM: string): number {
  const [by, bm] = bornYM.split("-").map(Number);
  return (LAST_YEAR - by) * 12 + (5 - bm) + 1; // through 2026-05
}

function ymLabel(bornYM: string, offset: number): string {
  const [by, bm] = bornYM.split("-").map(Number);
  const total = (by * 12 + (bm - 1)) + offset;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function repoDetail(owner: string, name: string): RepoDetail {
  const base = REPOS.find((r) => r.owner === owner && r.name === name) ?? REPOS[0];
  const meta = DESCRIPTIONS[base.name] ?? { desc: "An open-source project.", topics: ["open-source"], born: "2022-01" };
  const months = Math.max(8, monthsBetween(meta.born));

  const series = Array.from({ length: months }, (_, i) => {
    const t = i / (months - 1);
    // smoothstep blended with a linear floor so recent months keep growing
    const eased = 0.8 * (t * t * (3 - 2 * t)) + 0.2 * t;
    const noise = 1 + (pseudo(base.total, i) - 0.5) * 0.06;
    return { label: ymLabel(meta.born, i), total: Math.round(base.total * eased * noise) };
  });
  series[series.length - 1].total = base.total;
  for (let i = 1; i < series.length; i++) {
    if (series[i].total < series[i - 1].total) series[i].total = series[i - 1].total;
  }

  const milestones: Milestone[] = [];
  for (const stars of [10000, 50000, 100000]) {
    if (base.total < stars) continue;
    const idx = series.findIndex((p) => p.total >= stars);
    if (idx >= 0) milestones.push({ stars, label: `${stars / 1000}k`, monthIndex: idx, date: series[idx].label });
  }

  const monthly: MonthlyRow[] = series
    .slice(-12)
    .map((p, i, arr) => {
      const prev = i === 0 ? series[series.length - 13]?.total ?? 0 : arr[i - 1].total;
      return {
        month: p.label,
        gained: Math.max(0, p.total - prev),
        rank: 1 + Math.floor(pseudo(base.total, i) * 18),
      };
    })
    .reverse();

  return {
    owner: base.owner,
    name: base.name,
    lang: base.lang,
    description: meta.desc,
    total: base.total,
    createdAt: meta.born,
    topics: meta.topics,
    series,
    milestones,
    monthly,
  };
}
