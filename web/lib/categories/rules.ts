export const CATEGORY_RULES_VERSION = "2026-06-07.2";

export const CATEGORY_DIMENSIONS = [
  "language",
  "language_family",
  "domain",
  "project_type",
  "ecosystem",
  "owner_kind",
  "maturity",
] as const;

export type CategoryDimension = (typeof CATEGORY_DIMENSIONS)[number];
export type CategoryAssignment = Record<CategoryDimension, string[]>;

export interface CategoryDefinition {
  dimension: CategoryDimension;
  slug: string;
  label: string;
  description?: string;
  aliases?: string[];
  public?: boolean;
  sitemap?: boolean;
  curated?: boolean;
  minimumRepoCount?: number;
  order?: number;
}

export interface CategoryRepoInput {
  owner_type?: string | null;
  name?: string | null;
  full_name?: string | null;
  description?: string | null;
  language?: string | null;
  languages?: Array<{ name: string; size?: number | null; color?: string | null }> | null;
  topics?: string[] | null;
  current_stars?: number | null;
  is_archived?: boolean | null;
  crossed_10k?: string | null;
  crossed_50k?: string | null;
  crossed_100k?: string | null;
}

export interface ClassificationOptions {
  generatedAt?: string;
}

const DEFAULT_MINIMUM_REPO_COUNT = 20;
const NEWCOMER_DAYS = 366;
const SECONDARY_LANGUAGE_CATEGORY_MIN_SHARE = 0.1;

export const PRIORITY_LANGUAGE_SLUGS = [
  "python",
  "html",
  "javascript",
  "typescript",
  "go",
  "rust",
  "java",
  "c",
  "cpp",
  "csharp",
  "php",
  "ruby",
  "swift",
  "kotlin",
  "dart",
  "shell",
  "css",
  "vue",
  "svelte",
] as const;

const languageDefinitions: CategoryDefinition[] = [
  { dimension: "language", slug: "python", label: "Python", aliases: ["py"], curated: true, order: 10 },
  { dimension: "language", slug: "html", label: "HTML", curated: true, order: 20 },
  { dimension: "language", slug: "javascript", label: "JavaScript", aliases: ["js"], curated: true, order: 30 },
  { dimension: "language", slug: "typescript", label: "TypeScript", aliases: ["ts"], curated: true, order: 40 },
  { dimension: "language", slug: "go", label: "Go", curated: true, order: 50 },
  { dimension: "language", slug: "rust", label: "Rust", curated: true, order: 60 },
  { dimension: "language", slug: "java", label: "Java", curated: true, order: 70 },
  { dimension: "language", slug: "c", label: "C", curated: true, order: 80 },
  { dimension: "language", slug: "cpp", label: "C++", aliases: ["c++"], curated: true, order: 90 },
  { dimension: "language", slug: "csharp", label: "C#", aliases: ["c#"], curated: true, order: 100 },
  { dimension: "language", slug: "php", label: "PHP", curated: true, order: 110 },
  { dimension: "language", slug: "ruby", label: "Ruby", curated: true, order: 120 },
  { dimension: "language", slug: "swift", label: "Swift", curated: true, order: 130 },
  { dimension: "language", slug: "kotlin", label: "Kotlin", curated: true, order: 140 },
  { dimension: "language", slug: "dart", label: "Dart", curated: true, order: 150 },
  { dimension: "language", slug: "shell", label: "Shell", curated: true, order: 160 },
  { dimension: "language", slug: "css", label: "CSS", curated: true, order: 170 },
  { dimension: "language", slug: "vue", label: "Vue", curated: true, order: 180 },
  { dimension: "language", slug: "svelte", label: "Svelte", curated: true, order: 190 },
  { dimension: "language", slug: "unknown", label: "Unknown", public: false, sitemap: false, order: 10_000 },
];

const familyDefinitions: CategoryDefinition[] = [
  { dimension: "language_family", slug: "js-ts", label: "JavaScript / TypeScript", order: 10 },
  { dimension: "language_family", slug: "python", label: "Python", order: 20 },
  { dimension: "language_family", slug: "web-markup", label: "Web Markup", order: 30 },
  { dimension: "language_family", slug: "systems", label: "Systems", order: 40 },
  { dimension: "language_family", slug: "jvm", label: "JVM", order: 50 },
  { dimension: "language_family", slug: "dotnet", label: ".NET", order: 60 },
  { dimension: "language_family", slug: "mobile", label: "Mobile", order: 70 },
  { dimension: "language_family", slug: "shell", label: "Shell", order: 80 },
  { dimension: "language_family", slug: "data-query", label: "Data Query", order: 90 },
  { dimension: "language_family", slug: "other", label: "Other", order: 900 },
  { dimension: "language_family", slug: "unknown", label: "Unknown", public: false, sitemap: false, order: 1000 },
];

const domainDefinitions: CategoryDefinition[] = [
  { dimension: "domain", slug: "ai-ml", label: "AI / ML", order: 10 },
  { dimension: "domain", slug: "web-frontend", label: "Web Frontend", order: 20 },
  { dimension: "domain", slug: "web-backend", label: "Web Backend", order: 30 },
  { dimension: "domain", slug: "devtools", label: "DevTools", order: 40 },
  { dimension: "domain", slug: "infra-cloud", label: "Infrastructure / Cloud", order: 50 },
  { dimension: "domain", slug: "data-db", label: "Data / Databases", order: 60 },
  { dimension: "domain", slug: "security", label: "Security", order: 70 },
  { dimension: "domain", slug: "mobile", label: "Mobile", order: 80 },
  { dimension: "domain", slug: "game-dev", label: "Game Development", order: 90 },
  { dimension: "domain", slug: "blockchain", label: "Blockchain", order: 100 },
  { dimension: "domain", slug: "design", label: "Design", order: 110 },
  { dimension: "domain", slug: "docs-content", label: "Docs / Content", order: 120 },
  { dimension: "domain", slug: "hardware-iot", label: "Hardware / IoT", order: 130 },
  { dimension: "domain", slug: "education", label: "Education", order: 140 },
  { dimension: "domain", slug: "automation", label: "Automation", order: 150 },
];

const projectTypeDefinitions: CategoryDefinition[] = [
  { dimension: "project_type", slug: "framework", label: "Framework", order: 10 },
  { dimension: "project_type", slug: "library", label: "Library", order: 20 },
  { dimension: "project_type", slug: "cli", label: "CLI", order: 30 },
  { dimension: "project_type", slug: "app", label: "App", order: 40 },
  { dimension: "project_type", slug: "platform", label: "Platform", order: 50 },
  { dimension: "project_type", slug: "runtime", label: "Runtime", order: 60 },
  { dimension: "project_type", slug: "database", label: "Database", order: 70 },
  { dimension: "project_type", slug: "sdk", label: "SDK", order: 80 },
  { dimension: "project_type", slug: "template", label: "Template", order: 90 },
  { dimension: "project_type", slug: "learning-resource", label: "Learning Resource", order: 100 },
  { dimension: "project_type", slug: "tool", label: "Tool", order: 110 },
  { dimension: "project_type", slug: "plugin", label: "Plugin", order: 120 },
  { dimension: "project_type", slug: "extension", label: "Extension", order: 130 },
];

const ecosystemDefinitions: CategoryDefinition[] = [
  { dimension: "ecosystem", slug: "node", label: "Node.js", order: 10 },
  { dimension: "ecosystem", slug: "python", label: "Python", order: 20 },
  { dimension: "ecosystem", slug: "rust", label: "Rust", order: 30 },
  { dimension: "ecosystem", slug: "go", label: "Go", order: 40 },
  { dimension: "ecosystem", slug: "browser", label: "Browser", order: 50 },
  { dimension: "ecosystem", slug: "react", label: "React", order: 60 },
  { dimension: "ecosystem", slug: "vue", label: "Vue", order: 70 },
  { dimension: "ecosystem", slug: "svelte", label: "Svelte", order: 80 },
  { dimension: "ecosystem", slug: "nextjs", label: "Next.js", order: 90 },
  { dimension: "ecosystem", slug: "deno-bun", label: "Deno / Bun", order: 100 },
  { dimension: "ecosystem", slug: "jupyter", label: "Jupyter", order: 110 },
  { dimension: "ecosystem", slug: "docker-kubernetes", label: "Docker / Kubernetes", order: 120 },
  { dimension: "ecosystem", slug: "terraform", label: "Terraform", order: 130 },
  { dimension: "ecosystem", slug: "android", label: "Android", order: 140 },
  { dimension: "ecosystem", slug: "ios", label: "iOS", order: 150 },
];

const ownerKindDefinitions: CategoryDefinition[] = [
  { dimension: "owner_kind", slug: "organization", label: "Organizations", order: 10 },
  { dimension: "owner_kind", slug: "user", label: "Users", order: 20 },
  { dimension: "owner_kind", slug: "unknown", label: "Unknown", public: false, sitemap: false, order: 100 },
];

const maturityDefinitions: CategoryDefinition[] = [
  { dimension: "maturity", slug: "star-10k", label: "10k+ Stars", order: 10 },
  { dimension: "maturity", slug: "star-50k", label: "50k+ Stars", order: 20 },
  { dimension: "maturity", slug: "star-100k", label: "100k+ Stars", order: 30 },
  { dimension: "maturity", slug: "newcomer-10k", label: "Recent 10k Newcomers", order: 40 },
  { dimension: "maturity", slug: "active", label: "Active", order: 50 },
  { dimension: "maturity", slug: "archived", label: "Archived", order: 60 },
];

export const STATIC_CATEGORY_DEFINITIONS: readonly CategoryDefinition[] = [
  ...languageDefinitions,
  ...familyDefinitions,
  ...domainDefinitions,
  ...projectTypeDefinitions,
  ...ecosystemDefinitions,
  ...ownerKindDefinitions,
  ...maturityDefinitions,
];

const languageFamilyBySlug = new Map<string, string>([
  ["javascript", "js-ts"],
  ["typescript", "js-ts"],
  ["html", "web-markup"],
  ["css", "web-markup"],
  ["vue", "web-markup"],
  ["svelte", "web-markup"],
  ["python", "python"],
  ["go", "systems"],
  ["rust", "systems"],
  ["c", "systems"],
  ["cpp", "systems"],
  ["java", "jvm"],
  ["kotlin", "jvm"],
  ["scala", "jvm"],
  ["csharp", "dotnet"],
  ["fsharp", "dotnet"],
  ["swift", "mobile"],
  ["dart", "mobile"],
  ["shell", "shell"],
  ["powershell", "shell"],
  ["sql", "data-query"],
]);

const languageSlugOverrides = new Map<string, string>([
  ["c++", "cpp"],
  ["c#", "csharp"],
  ["f#", "fsharp"],
  ["objective-c", "objective-c"],
  ["objective-c++", "objective-cpp"],
  ["shell", "shell"],
  ["html", "html"],
  ["css", "css"],
  ["vue", "vue"],
  ["svelte", "svelte"],
  ["go", "go"],
]);

const languageLabelBySlug = new Map<string, string>();
for (const def of languageDefinitions) languageLabelBySlug.set(def.slug, def.label);

export function categoryId(dimension: CategoryDimension, slug: string): string {
  return `${dimension}/${slug}`;
}

export function slugifyCategoryPart(value: string): string {
  const lower = value.trim().toLowerCase();
  const override = languageSlugOverrides.get(lower);
  if (override) return override;
  const slug = lower
    .replaceAll("+", "p")
    .replaceAll("#", "sharp")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "unknown";
}

export function labelFromSlug(slug: string): string {
  const known = languageLabelBySlug.get(slug);
  if (known) return known;
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function languageCategoryFromLanguage(language?: string | null): { id: string; slug: string; label: string } {
  if (!language || !language.trim()) return { id: "language/unknown", slug: "unknown", label: "Unknown" };
  const slug = slugifyCategoryPart(language);
  return { id: categoryId("language", slug), slug, label: languageLabelBySlug.get(slug) ?? language.trim() };
}

export function categoryLanguageNamesFromRepository(repo: CategoryRepoInput): string[] {
  const primary = repo.language?.trim() || null;
  const breakdown = (repo.languages ?? [])
    .map((language) => ({
      name: language.name.trim(),
      size: Math.max(0, language.size ?? 0),
    }))
    .filter((language) => language.name);
  const total = breakdown.reduce((sum, language) => sum + language.size, 0);
  const names: string[] = primary ? [primary] : [];

  if (total > 0) {
    for (const language of breakdown) {
      if (primary && slugifyCategoryPart(language.name) === slugifyCategoryPart(primary)) continue;
      if (language.size / total >= SECONDARY_LANGUAGE_CATEGORY_MIN_SHARE) names.push(language.name);
    }
  } else if (!primary && breakdown.length > 0) {
    names.push(breakdown[0].name);
  }

  return names.length ? names : ["Unknown"];
}

export function languageCategoriesFromRepository(repo: CategoryRepoInput): Array<{ id: string; slug: string; label: string }> {
  const seen = new Set<string>();
  const categories: Array<{ id: string; slug: string; label: string }> = [];
  for (const name of categoryLanguageNamesFromRepository(repo)) {
    const category = languageCategoryFromLanguage(name);
    if (seen.has(category.id)) continue;
    seen.add(category.id);
    categories.push(category);
  }
  return categories.length ? categories : [languageCategoryFromLanguage(null)];
}

export function languageFamilyForLanguageSlug(languageSlug: string): string {
  if (languageSlug === "unknown") return "unknown";
  return languageFamilyBySlug.get(languageSlug) ?? "other";
}

interface KeywordRule {
  slug: string;
  topics?: string[];
  keywords?: string[];
  languages?: string[];
}

const domainRules: KeywordRule[] = [
  {
    slug: "ai-ml",
    topics: ["ai", "artificial-intelligence", "machine-learning", "deep-learning", "llm", "nlp", "computer-vision"],
    keywords: ["machine learning", "deep learning", "artificial intelligence", "neural", "llm", "tensorflow", "pytorch"],
  },
  {
    slug: "web-frontend",
    topics: ["frontend", "front-end", "web", "webapp", "react", "vue", "svelte", "css", "html"],
    keywords: ["frontend", "front-end", "web ui", "react", "vue", "svelte"],
    languages: ["html", "css", "vue", "svelte"],
  },
  { slug: "web-backend", topics: ["backend", "api", "server", "graphql", "rest-api"], keywords: ["backend", "api server", "graphql"] },
  {
    slug: "devtools",
    topics: ["developer-tools", "devtools", "debugger", "testing", "lint", "compiler"],
    keywords: ["developer tool", "devtools", "debugger", "linter", "compiler"],
  },
  {
    slug: "infra-cloud",
    topics: ["cloud", "kubernetes", "docker", "devops", "infrastructure", "terraform", "serverless"],
    keywords: ["kubernetes", "docker", "terraform", "infrastructure", "serverless"],
  },
  {
    slug: "data-db",
    topics: ["database", "db", "sql", "nosql", "data", "analytics", "etl", "warehouse"],
    keywords: ["database", "sql", "nosql", "analytics", "data pipeline"],
  },
  { slug: "security", topics: ["security", "cryptography", "malware", "pentest", "privacy"], keywords: ["security", "cryptography", "pentest"] },
  { slug: "mobile", topics: ["android", "ios", "mobile", "react-native", "flutter"], keywords: ["android", "ios", "mobile app"], languages: ["swift", "kotlin", "dart"] },
  { slug: "game-dev", topics: ["game", "game-engine", "gamedev", "unity", "godot"], keywords: ["game engine", "game development"] },
  { slug: "blockchain", topics: ["blockchain", "crypto", "ethereum", "bitcoin", "web3"], keywords: ["blockchain", "ethereum", "bitcoin", "web3"] },
  { slug: "design", topics: ["design", "ui", "ux", "figma", "design-system"], keywords: ["design system", "figma", "ui kit"] },
  { slug: "docs-content", topics: ["documentation", "docs", "static-site", "markdown"], keywords: ["documentation", "markdown", "static site"] },
  { slug: "hardware-iot", topics: ["iot", "hardware", "embedded", "arduino", "raspberry-pi"], keywords: ["embedded", "arduino", "raspberry pi"] },
  { slug: "education", topics: ["education", "learning", "tutorial", "course"], keywords: ["tutorial", "course", "learn"] },
  { slug: "automation", topics: ["automation", "bot", "workflow", "rpa"], keywords: ["automation", "workflow"] },
];

const projectTypeRules: KeywordRule[] = [
  { slug: "framework", topics: ["framework"], keywords: ["framework"] },
  { slug: "library", topics: ["library", "package"], keywords: ["library"] },
  { slug: "cli", topics: ["cli", "command-line", "terminal"], keywords: ["command line", "cli"] },
  { slug: "app", topics: ["app", "desktop-app", "webapp"], keywords: ["desktop app", "web app"] },
  { slug: "platform", topics: ["platform"], keywords: ["platform"] },
  { slug: "runtime", topics: ["runtime"], keywords: ["runtime"] },
  { slug: "database", topics: ["database", "db", "sql", "nosql"], keywords: ["database"] },
  { slug: "sdk", topics: ["sdk", "api-client"], keywords: ["sdk"] },
  { slug: "template", topics: ["template", "starter", "boilerplate"], keywords: ["template", "starter", "boilerplate"] },
  { slug: "learning-resource", topics: ["awesome", "tutorial", "course", "learning"], keywords: ["awesome", "tutorial", "course"] },
  { slug: "tool", topics: ["tool", "tools", "utility"], keywords: ["tool", "utility"] },
  { slug: "plugin", topics: ["plugin"], keywords: ["plugin"] },
  { slug: "extension", topics: ["extension", "vscode-extension", "browser-extension"], keywords: ["extension"] },
];

const ecosystemRules: KeywordRule[] = [
  { slug: "node", topics: ["node", "nodejs", "npm", "javascript"], keywords: ["node.js", "nodejs"] },
  { slug: "python", topics: ["python", "pypi", "django", "flask", "fastapi"], languages: ["python"] },
  { slug: "rust", topics: ["rust", "cargo"], languages: ["rust"] },
  { slug: "go", topics: ["go", "golang"], languages: ["go"] },
  { slug: "browser", topics: ["browser", "web", "html", "css"], languages: ["html", "css", "vue", "svelte"] },
  { slug: "react", topics: ["react", "reactjs", "react-native"], keywords: ["react"] },
  { slug: "vue", topics: ["vue", "vuejs"], languages: ["vue"] },
  { slug: "svelte", topics: ["svelte", "sveltekit"], languages: ["svelte"] },
  { slug: "nextjs", topics: ["nextjs", "next-js"], keywords: ["next.js", "nextjs"] },
  { slug: "deno-bun", topics: ["deno", "bun"], keywords: ["deno", "bun runtime"] },
  { slug: "jupyter", topics: ["jupyter", "notebook"], keywords: ["jupyter"] },
  { slug: "docker-kubernetes", topics: ["docker", "kubernetes", "k8s"], keywords: ["docker", "kubernetes"] },
  { slug: "terraform", topics: ["terraform", "hcl"], keywords: ["terraform"] },
  { slug: "android", topics: ["android"], keywords: ["android"], languages: ["kotlin"] },
  { slug: "ios", topics: ["ios", "swift"], keywords: ["ios"], languages: ["swift"] },
];

function emptyAssignment(): CategoryAssignment {
  return {
    language: [],
    language_family: [],
    domain: [],
    project_type: [],
    ecosystem: [],
    owner_kind: [],
    maturity: [],
  };
}

function normalizedTopics(repo: CategoryRepoInput): Set<string> {
  return new Set((repo.topics ?? []).map((topic) => topic.trim().toLowerCase()).filter(Boolean));
}

function textHaystack(repo: CategoryRepoInput): string {
  return [repo.full_name, repo.name, repo.description].filter(Boolean).join(" ").toLowerCase();
}

function matchRules(repo: CategoryRepoInput, languageSlugs: string[], rules: KeywordRule[], dimension: CategoryDimension): string[] {
  const topics = normalizedTopics(repo);
  const text = textHaystack(repo);
  const ids: string[] = [];
  for (const rule of rules) {
    const topicMatch = (rule.topics ?? []).some((topic) => topics.has(topic));
    const languageMatch = (rule.languages ?? []).some((language) => languageSlugs.includes(language));
    const keywordMatch = (rule.keywords ?? []).some((keyword) => text.includes(keyword));
    if (topicMatch || languageMatch || keywordMatch) ids.push(categoryId(dimension, rule.slug));
  }
  return uniqueSorted(ids);
}

function ownerKind(repo: CategoryRepoInput): string {
  if (repo.owner_type === "Organization") return "organization";
  if (repo.owner_type === "User") return "user";
  return "unknown";
}

function isRecentCrossing(crossed10k: string | null | undefined, generatedAt: string | undefined): boolean {
  if (!crossed10k || !generatedAt) return false;
  const crossed = Date.parse(`${crossed10k.slice(0, 10)}T00:00:00Z`);
  const generated = Date.parse(`${generatedAt.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(crossed) || !Number.isFinite(generated)) return false;
  const ageDays = (generated - crossed) / 86_400_000;
  return ageDays >= 0 && ageDays <= NEWCOMER_DAYS;
}

function maturity(repo: CategoryRepoInput, options: ClassificationOptions): string[] {
  const out: string[] = [];
  const stars = repo.current_stars ?? 0;
  if (stars >= 10_000) out.push("maturity/star-10k");
  if (stars >= 50_000) out.push("maturity/star-50k");
  if (stars >= 100_000) out.push("maturity/star-100k");
  if (isRecentCrossing(repo.crossed_10k, options.generatedAt)) out.push("maturity/newcomer-10k");
  out.push(repo.is_archived ? "maturity/archived" : "maturity/active");
  return out;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function classifyRepository(repo: CategoryRepoInput, options: ClassificationOptions = {}): CategoryAssignment {
  const assignment = emptyAssignment();
  const languages = languageCategoriesFromRepository(repo);
  const languageSlugs = languages.map((language) => language.slug);
  const families = uniqueSorted(languageSlugs.map((slug) => categoryId("language_family", languageFamilyForLanguageSlug(slug))));

  assignment.language = languages.map((language) => language.id);
  assignment.language_family = families;
  assignment.owner_kind = [categoryId("owner_kind", ownerKind(repo))];
  assignment.maturity = maturity(repo, options);
  assignment.domain = matchRules(repo, languageSlugs, domainRules, "domain");
  assignment.project_type = matchRules(repo, languageSlugs, projectTypeRules, "project_type");
  assignment.ecosystem = matchRules(repo, languageSlugs, ecosystemRules, "ecosystem");

  return assignment;
}

export function definitionMinimumRepoCount(def: CategoryDefinition): number {
  return def.minimumRepoCount ?? DEFAULT_MINIMUM_REPO_COUNT;
}
