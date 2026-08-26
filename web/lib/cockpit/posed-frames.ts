export const COCKPIT_PATH = "/cockpit";
export const AS_OF = "2026-08";
export const FIRST_MONTH = "2015-01";

export type DomainGroup = "ai" | "devtools" | "database" | "infra" | "web" | "other";

export type PosedNode = {
  id: string;
  label?: string;
  domain: DomainGroup;
  x: number;
  y: number;
  born: number;
  keypoints: ReadonlyArray<readonly [number, number]>;
};

export type Milestone = { stars: 10_000 | 50_000 | 100_000; period: string };

const DOMAIN_ANGLE: Record<DomainGroup, number> = {
  ai: 0.35,
  web: 1.7,
  infra: 2.9,
  database: 4.1,
  devtools: 5.2,
  other: 5.9,
};

export const DOMAIN_COLORS: Record<DomainGroup, string> = {
  ai: "#ffba3b",
  devtools: "#eac080",
  database: "#9edaff",
  infra: "#a78bfa",
  web: "#4ade80",
  other: "#8d9199",
};

export const MONTHS: readonly string[] = buildMonths(FIRST_MONTH, AS_OF);

export function monthIndex(period: string): number {
  const i = MONTHS.indexOf(period);
  if (i < 0) throw new Error(`unknown posed period ${period}`);
  return i;
}

export function lerpStock(keypoints: ReadonlyArray<readonly [number, number]>, at: number): number {
  if (at < keypoints[0][0]) return 0;
  const last = keypoints[keypoints.length - 1];
  if (at >= last[0]) return last[1];
  for (let i = 0; i < keypoints.length - 1; i++) {
    const [t0, v0] = keypoints[i];
    const [t1, v1] = keypoints[i + 1];
    if (at <= t1) {
      const u = (at - t0) / Math.max(1, t1 - t0);
      return Math.round(v0 + (v1 - v0) * u);
    }
  }
  return last[1];
}

export function stockAt(node: PosedNode, at: number): number {
  if (at < node.born) return 0;
  return lerpStock(node.keypoints, at);
}

export function flowAt(node: PosedNode, at: number): number {
  if (at <= node.born) return 0;
  return stockAt(node, at) - stockAt(node, at - 1);
}

export function formatStars(n: number): string {
  if (n < 1000) return String(n);
  const rounded = Math.round((n / 1000) * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}k` : `${rounded.toFixed(1)}k`;
}

export function formatDelta(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${formatStars(Math.abs(n))}`;
}

const T = {
  transformers10k: monthIndex("2019-07"),
  transformers50k: monthIndex("2021-06"),
  transformers100k: monthIndex("2023-04"),
  asOf: monthIndex(AS_OF),
};

function rng(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function place(domain: DomainGroup, radius: number, jitter: number, rand: () => number): { x: number; y: number } {
  const a = DOMAIN_ANGLE[domain] + (rand() - 0.5) * 0.7;
  const r = radius + (rand() - 0.5) * jitter;
  return {
    x: clamp01(0.5 + Math.cos(a) * r),
    y: clamp01(0.5 + Math.sin(a) * r * 0.82),
  };
}

function clamp01(n: number): number {
  return Math.min(0.92, Math.max(0.08, n));
}

const rand = rng(20260822);

const ANCHORS: PosedNode[] = [
  node("facebook/react", "React", "web", 0.36, 0.3, 0, [
    [0, 48_000],
    [T.asOf, 236_000],
  ]),
  node("vuejs/vue", "Vue", "web", 0.47, 0.58, 0, [
    [0, 22_000],
    [T.asOf, 209_900],
  ]),
  node("kubernetes/kubernetes", "Kubernetes", "infra", 0.27, 0.55, 0, [
    [0, 18_000],
    [T.asOf, 117_400],
  ]),
  node("rust-lang/rust", "Rust", "devtools", 0.42, 0.74, 0, [
    [0, 16_000],
    [T.asOf, 108_200],
  ]),
  node("ollama/ollama", "Ollama", "ai", 0.63, 0.48, monthIndex("2023-10"), [
    [monthIndex("2023-10"), 10_000],
    [T.asOf, 174_600],
  ]),
  node("langchain-ai/langchain", "LangChain", "ai", 0.58, 0.64, monthIndex("2022-11"), [
    [monthIndex("2022-11"), 8_000],
    [monthIndex("2023-06"), 40_000],
    [T.asOf, 118_400],
  ]),
  node("huggingface/transformers", "Transformers", "ai", 0.71, 0.36, monthIndex("2019-01"), [
    [monthIndex("2019-01"), 4_000],
    [T.transformers10k, 10_000],
    [T.transformers50k, 50_000],
    [T.transformers100k, 100_000],
    [T.asOf, 164_100],
  ]),
];

const FILL_DOMAINS: DomainGroup[] = ["ai", "ai", "ai", "web", "infra", "database", "devtools", "other"];

function filler(i: number): PosedNode {
  const domain = FILL_DOMAINS[i % FILL_DOMAINS.length];
  const born = rand() < 0.72 ? 0 : Math.floor(8 + rand() * 40);
  const start = 2_000 + Math.floor(rand() * 12_000);
  const end = start + 4_000 + Math.floor(rand() ** 1.35 * 70_000);
  const pos = place(domain, 0.08 + rand() * 0.38, 0.1, rand);
  return {
    id: `posed/${domain}-${i}`,
    domain,
    x: pos.x,
    y: pos.y,
    born,
    keypoints: [
      [born, start],
      [T.asOf, end],
    ],
  };
}

export const NODES: readonly PosedNode[] = [...ANCHORS, ...Array.from({ length: 320 }, (_, i) => filler(i))];

export const HEADLINES = {
  movingNow: "huggingface/transformers",
  speedingUp: "langchain-ai/langchain",
  newOnTheMap: "ollama/ollama",
} as const;

export const MILESTONES: Record<string, Milestone[]> = {
  "huggingface/transformers": [
    { stars: 10_000, period: "2019-07" },
    { stars: 50_000, period: "2021-06" },
    { stars: 100_000, period: "2023-04" },
  ],
  "facebook/react": [
    { stars: 10_000, period: "2015-01" },
    { stars: 50_000, period: "2015-08" },
    { stars: 100_000, period: "2016-06" },
  ],
  "ollama/ollama": [{ stars: 10_000, period: "2023-10" }],
};

export const THIS_MONTH_DELTAS: Record<string, number> = {
  "huggingface/transformers": 9_200,
  "langchain-ai/langchain": 11_200,
  "ollama/ollama": 18_600,
};

export function nodeById(id: string): PosedNode {
  const found = NODES.find((n) => n.id === id);
  if (!found) throw new Error(`unknown posed node ${id}`);
  return found;
}

function node(
  id: string,
  label: string,
  domain: DomainGroup,
  x: number,
  y: number,
  born: number,
  keypoints: ReadonlyArray<readonly [number, number]>,
): PosedNode {
  return { id, label, domain, x, y, born, keypoints };
}

function buildMonths(from: string, to: string): string[] {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const out: string[] = [];
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); ) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
