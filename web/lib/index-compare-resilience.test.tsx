import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompareCurve, type Meta, type OrgsLookup } from "@/lib/contracts";
import { getDictionary, LOCALES, type Locale } from "@/lib/i18n";
import { COMMON_COMPARE_PAIRS } from "@/lib/compare/conclusions";

const names = COMMON_COMPARE_PAIRS.flatMap((pair) => [pair.a, pair.b]);
const repoIds = new Map(names.map((name, index) => [name.toLowerCase(), index + 1]));
const curves = new Map<number, CompareCurve>(names.map((name, index) => [index + 1, {
  id: index + 1, full_name: name, current_stars: 20_000 + index * 1_000,
  crossed_10k: "2024-01-01", points: [["2024-01", 10_000], ["2024-02", 12_000 + index * 1_000], ["2024-03", 20_000 + index * 1_000]],
}]));
const meta: Meta = { seam_date: "2024-01-01", schema_ver: 1, generated_at: "2024-03-01T12:00:00.000Z", folded_through: { month: "2024-03", week: "2024-W09" } };
const orgs: OrgsLookup = { example: { login: "example", owner_type: "Organization", repo_count: 2, current_stars_sum: 40_000 } };
let orgLookup: OrgsLookup | null = orgs;
let failedIds = new Set<number>();
let absentIds = new Set<number>();
let schemaFailure = false;
let metaFailure = false;
let lookupFailure = false;
const failure = new Error("optional curve transport failed");
const originalWarn = console.warn;
let diagnostics: unknown[][] = [];
console.warn = (...args: unknown[]) => { diagnostics.push(args); };

mock.module("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  usePathname: () => "/compare",
  useRouter: () => ({ replace: () => undefined, push: () => undefined, prefetch: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("@/lib/data", () => ({
  getMeta: async () => { if (metaFailure) throw new Error("metadata failed"); return meta; },
  getOrgsLookup: async () => orgLookup,
  getRepoIdByFullName: async () => { if (lookupFailure) throw new Error("lookup failed"); return repoIds; },
  getRepoCurve: async (id: number) => { if (failedIds.has(id)) { if (schemaFailure) CompareCurve.parse({}); throw failure; } return absentIds.has(id) ? null : curves.get(id) ?? null; },
  getCategoryRegistry: async () => null,
  getCategoryAllTimePage: async () => null,
  getReposLookupDaily: async () => ({}),
  joinRepoRank: () => [],
}));
const { OrgIndexPageView } = await import("@/app/_localized/org-index");
const { ComparePageView } = await import("@/app/_localized/compare");
const { CategoriesPageView } = await import("@/app/_localized/categories");

function render(element: ReactElement) { return renderToStaticMarkup(element); }
function hash(html: string) { return createHash("sha256").update(html).digest("hex"); }

afterEach(() => {
  schemaFailure = false; orgLookup = orgs; failedIds = new Set(); absentIds = new Set(); metaFailure = false; lookupFailure = false; diagnostics = [];
});
afterAll(() => {
  console.warn = originalWarn;
  mock.restore();
});

// SHA-256 of the shared chrome HTML. Refreshed when the header search classes change (#819).
const baseline: Record<string, Record<string, string>> = {
  "en": {
    "org": "b64f7069b6fc8f4caf81f1956ab8e2b0ffd28620ca22465087ef79729bb20d5a",
    "compare": "4f45dccb3b1dfa880deb1dacafa9743bd3bae3abaef1ea6485ab8d62a4fc0323",
    "categories": "7f1e9723d313363c48d63beb7ed206ed551f4592f39f43da054eeee9c25813c0"
  },
  "ja": {
    "org": "c6d336868f9b234cc9842b2a483a7c7c5aa4c51b95a3d7d33c115940cf898412",
    "compare": "520c013b961ef95b334540cd12dafd6b61c1bdeed87f17a519c342864a533d6f",
    "categories": "1891f9ea5cedad24da62f350ce76a012f88e5c74a3ef1e6499c78247cb1f38e6"
  },
  "zh": {
    "org": "5e3f478678430c527118dba1047c52fdfe78cd669df78b6fd26f73f7e239f9da",
    "compare": "09c2b2b73721ce43244b16b544ce8ca3afe4fb81c3ecc55ba29c281871300437",
    "categories": "d73fbab2279be6d86deadbc1ad62012d9fb8f3b1fd815fce9077ef9b8f92a8be"
  },
  "zh-TW": {
    "org": "fb221fc3ae3fa348c2f4f9d5e74afb21c7a064d9b370c089db704c35547634ee",
    "compare": "39dfd1f72f9d260483b41edf9a49f82bb81bd3610a1cf21d86ad192c239c80cf",
    "categories": "a708c5e5863748b3b6ccc3ad9130653ac1dadf64840e4d28e9dc708c3a8f5ce9"
  },
  "ko": {
    "org": "bcb4618ed24ef14c17cdfa27364194c98ea396e0baf05e9432ed4791c4d35958",
    "compare": "95a997a185240ebcef76a671cd2e45738ff33c9617e090da63fbb81b4a2285bd",
    "categories": "ea83de89700978bd059b064752010bb3ba516c001589371aead6015a9be51316"
  },
  "es": {
    "org": "a260ddfc31f2bfaa2388e22770035a8a18168deefaef6ff1b3526a103a1018f9",
    "compare": "b2e4838419d27b7e929bc9ffadefbb78a0890b4e75a94573c2f69dde9244d11b",
    "categories": "1afd8d2fc0aff484db6771251229278994af6676b8e0b820f70c230c6a194557"
  },
  "fr": {
    "org": "982ed504d1ac44265585cb3b4fa732f66a0aacdcf6ac4705fd324b0639f0c08f",
    "compare": "9d7acc96cd8739299bd9784baa1a02dc8a5160e0614dd83d6f3a6687b004e65e",
    "categories": "3fe0d1e6c1ef9fe0a95b4ca6b6466b69b9d46084cf8b4b18ecc8311a9c1dd3a9"
  }
};

describe("successful page HTML stays stable", () => {
  test.each([...LOCALES])("%s matches its documented HTML baseline", async (locale) => {
    const html = {
      org: render(await OrgIndexPageView({ locale, page: 1 })),
      compare: render(await ComparePageView({ locale })),
      categories: render(await CategoriesPageView({ locale })),
    };
    expect(Object.fromEntries(Object.entries(html).map(([page, value]) => [page, hash(value)]))).toEqual(baseline[locale]);
  });
});

describe("organization index pending state", () => {
  for (const lookup of [null, {}] as const) {
    test.each([...LOCALES])(`%s explains ${lookup === null ? "missing" : "empty"} lookup`, async (locale) => {
      orgLookup = lookup;
      const t = await getDictionary(locale);
      const html = render(await OrgIndexPageView({ locale, page: 1 }));
      expect(html).toContain(render(<p>{t.categories.rankingPending}</p>).slice(3, -4));
      expect(html).toContain(t.org.indexTitle);
      expect(html).not.toContain("<table");
      expect(html).not.toContain('aria-label="' + t.org.indexPagination + '"');
      expect(html).toContain('"@type":"CollectionPage"');
    });
  }
});

describe("optional comparison example failures", () => {
  test.each([1, 2, 3, 4, 5, 6])("rejected curve %i skips only its pair", async (id) => {
    failedIds.add(id);
    const html = render(await ComparePageView({ locale: "en" }));
    const t = await getDictionary("en");
    expect(html).toContain('id="compare-workbench"');
    expect(html).toContain('id="server-compare-title"');
    const failedPair = COMMON_COMPARE_PAIRS[Math.floor((id - 1) / 2)];
    expect(html).not.toContain(`href="/${failedPair.a}"`);
    for (const pair of COMMON_COMPARE_PAIRS.filter((pair) => pair !== failedPair)) expect(html).toContain(`href="/${pair.a}"`);
    expect(html).toContain(t.compare.loadError.replace("{repo}", `${failedPair.a} ${t.common.versus} ${failedPair.b}`));
    expect(html).not.toContain(failure.message);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0][1]).toEqual({ pair: failedPair.label, error: failure });
  });
  test.each([...LOCALES])("%s keeps the workbench when all examples fail", async (locale: Locale) => {
    failedIds = new Set(repoIds.values());
    const html = render(await ComparePageView({ locale }));
    const t = await getDictionary(locale);
    expect(html).toContain('id="compare-workbench"');
    expect(html).not.toContain('id="server-compare-title"');
    expect(html).toContain(render(<p>{t.compare.empty}</p>).slice(3, -4));
    expect(diagnostics).toHaveLength(3);
  });
  test("missing curves quietly omit only their pair", async () => {
    absentIds.add(1);
    const html = render(await ComparePageView({ locale: "en" }));
    expect(html).toContain('id="compare-workbench"');
    expect(html).toContain('href="/vercel/next.js"');
    expect(html).not.toContain('href="/react/react"');
    expect(diagnostics).toEqual([]);
  });
  test("schema rejection is isolated and diagnosed", async () => {
    schemaFailure = true;
    failedIds.add(1);
    const html = render(await ComparePageView({ locale: "en" }));
    expect(html).toContain('id="compare-workbench"');
    expect(html).toContain('href="/vercel/next.js"');
    expect(diagnostics).toHaveLength(1);
    expect((diagnostics[0][1] as { error: Error }).error.name).toBe("ZodError");
  });
  test("missing IDs omit examples without reads or warnings", async () => {
    const { loadPairConclusions } = await import("@/app/_localized/comparison-page-data");
    const t = await getDictionary("en");
    expect(await loadPairConclusions(new Map(), "en", t.compare)).toEqual({ conclusions: [], unavailablePairs: [] });
    expect(diagnostics).toEqual([]);
  });
  test("metadata failures propagate", async () => {
    metaFailure = true;
    await expect(ComparePageView({ locale: "en" })).rejects.toThrow("metadata failed");
    expect(diagnostics).toEqual([]);
  });
  test("required lookup failures propagate", async () => {
    lookupFailure = true;
    await expect(ComparePageView({ locale: "en" })).rejects.toThrow("lookup failed");
    expect(diagnostics).toEqual([]);
  });
});
