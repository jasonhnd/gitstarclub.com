import {
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoPathPrefixes = ["web/", "pipeline/", "scripts/", ".github/"];
const ignoredDirectories = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "node_modules",
]);

// These documents intentionally preserve source paths from a point in time.
// Current-state docs are never silently exempted from reference validation.
export const historicalDocumentAllowlist = new Map([
  ["docs/CHANGELOG.md", "release entries are immutable historical records"],
  ["docs/analysis/DATA-CORRECTNESS-21.md", "closed point-in-time analysis"],
  ["docs/perf/CWV-25.md", "frozen performance baseline"],
]);

const generatedReferenceAllowlist = [
  {
    pattern: /^web\/\.env\.local$/,
    reason: "developer-local environment file",
  },
  {
    pattern: /^web\/public\/data\/exports\/v1\/(?:YYYY-MM-DD|\{[^/]+\})(?:\/.*)?$/,
    reason: "dated generated export output",
  },
  {
    pattern: /^web\/public\/data\/exports\/v1\/\*$/,
    reason: "generated export directory glob",
  },
];

const textFileExtensions = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile()) files.push(path);
  }

  return files;
}

function toRepoPath(path, root) {
  return relative(root, path).replaceAll("\\", "/");
}

function globPattern(pattern) {
  let expression = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      expression += ".*";
      index += 1;
    } else if (char === "*") {
      expression += "[^/]*";
    } else if (char === "?") {
      expression += "[^/]";
    } else {
      expression += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${expression}$`);
}

function normalizeReference(value) {
  return value
    .replace(/[,.;]+$/, "")
    .replace(/#L\d+(?:-L\d+)?$/, "")
    .replace(/:\d+(?::\d+)?$/, "");
}

export function extractRepoReferences(markdown) {
  const references = [];
  for (const match of markdown.matchAll(/`([^`\n]+)`/g)) {
    const span = match[1];
    const tokens = span.match(/(?:web|pipeline|scripts|\.github)\/[^\s,;，；|→]+/g) ?? [];
    for (const token of tokens) references.push(normalizeReference(token));
  }
  return references;
}

function lineForOffset(content, offset) {
  return content.slice(0, offset).split("\n").length;
}

function referenceLine(content, reference) {
  const offset = content.indexOf(reference);
  return offset === -1 ? 1 : lineForOffset(content, offset);
}

function isGeneratedReference(reference) {
  return generatedReferenceAllowlist.some(({ pattern }) => pattern.test(reference));
}

function referenceExists(reference, root, allPaths) {
  if (isGeneratedReference(reference)) return true;
  if (reference.includes("...") || reference.includes("{...}")) return false;
  if (reference.includes("*") || reference.includes("?")) {
    const pattern = globPattern(reference);
    return allPaths.some((path) => pattern.test(path));
  }
  return existsSync(resolve(root, reference));
}

export function checkDocReferences(root) {
  const allFiles = walk(root);
  const allPaths = allFiles.map((file) => toRepoPath(file, root));
  const markdownFiles = allFiles.filter((file) => file.endsWith(".md"));
  const issues = [];

  for (const file of markdownFiles) {
    const path = toRepoPath(file, root);
    if (historicalDocumentAllowlist.has(path)) continue;

    const content = readFileSync(file, "utf8");
    for (const reference of new Set(extractRepoReferences(content))) {
      if (!repoPathPrefixes.some((prefix) => reference.startsWith(prefix))) continue;
      if (referenceExists(reference, root, allPaths)) continue;
      issues.push(`${path}:${referenceLine(content, reference)} unresolved repository path: ${reference}`);
    }
  }

  return issues;
}

function sourceFilesForEnvInventory(root) {
  const roots = ["web", "pipeline", "scripts"];
  return roots.flatMap((path) => {
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) return [];
    return walk(absolute).filter((file) => {
      const extension = file.slice(file.lastIndexOf("."));
      return textFileExtensions.has(extension);
    });
  });
}

export function discoverEnvironmentVariables(root) {
  const variables = new Set();
  for (const file of sourceFilesForEnvInventory(root)) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      variables.add(match[1]);
    }
  }

  const runtimeConfig = readFileSync(resolve(root, "web/lib/runtime-config.ts"), "utf8");
  for (const match of runtimeConfig.matchAll(/env\.([A-Z][A-Z0-9_]*)/g)) {
    variables.add(match[1]);
  }
  return [...variables].sort();
}

export function checkEnvironmentInventory(root) {
  const ops = readFileSync(resolve(root, "docs/OPS.md"), "utf8");
  const inventory = ops.match(/<!-- env-inventory:start -->([\s\S]*?)<!-- env-inventory:end -->/);
  if (!inventory) return ["docs/OPS.md: missing env-inventory markers"];

  const documented = new Set(
    [...inventory[1].matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map((match) => match[1]),
  );
  const issues = discoverEnvironmentVariables(root)
    .filter((name) => !documented.has(name))
    .map((name) => `docs/OPS.md: environment inventory is missing ${name}`);

  if (documented.has("NEXT_PUBLIC_GA_ID")) {
    issues.push("docs/OPS.md: NEXT_PUBLIC_GA_ID is unsupported and must not be documented as configuration");
  }
  return issues;
}

function frontmatter(content) {
  if (!content.startsWith("---\n")) return "";
  const end = content.indexOf("\n---\n", 4);
  return end === -1 ? "" : content.slice(4, end);
}

export function checkMaintainedFacts(root) {
  const issues = [];
  const webPackage = JSON.parse(readFileSync(resolve(root, "web/package.json"), "utf8"));
  const frontend = readFileSync(resolve(root, "docs/FRONTEND.md"), "utf8");
  const seo = readFileSync(resolve(root, "docs/SEO.md"), "utf8");
  const expectedNext = `Next.js ${webPackage.dependencies.next}`;
  if (!frontend.includes(expectedNext)) issues.push(`docs/FRONTEND.md: expected ${expectedNext}`);
  if (!seo.includes(expectedNext)) issues.push(`docs/SEO.md: expected ${expectedNext}`);

  const ownerDocs = readdirSync(resolve(root, "docs"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => `docs/${entry.name}`)
    .filter((path) => /route and source inventory/.test(frontmatter(readFileSync(resolve(root, path), "utf8"))));
  if (ownerDocs.length !== 1 || ownerDocs[0] !== "docs/UIUX-ROUTE-INVENTORY.md") {
    issues.push(`route/source inventory must have exactly one owner; found: ${ownerDocs.join(", ") || "none"}`);
  }

  const api = readFileSync(resolve(root, "docs/API.md"), "utf8");
  const routeSources = walk(resolve(root, "web/app"))
    .map((file) => toRepoPath(file, root))
    .filter((path) => path.endsWith("/route.ts"));
  const requiredApiSources = [
    ...routeSources.filter((path) => !/^web\/app\/sitemap-[^/]+\.xml\/route\.ts$/.test(path)),
    "web/app/sitemap-*.xml/route.ts",
    "web/app/robots.ts",
    "web/app/manifest.ts",
    "web/app/opengraph-image.tsx",
    "web/app/(en)/[locale]/[owner]/opengraph-image.tsx",
    "web/app/(en)/rankings/[year]/opengraph-image.tsx",
    "web/app/(en)/rankings/[year]/[period]/opengraph-image.tsx",
  ];
  for (const source of requiredApiSources) {
    if (!api.includes(source)) issues.push(`docs/API.md: endpoint inventory is missing ${source}`);
  }

  const rootReadme = readFileSync(resolve(root, "README.md"), "utf8");
  if (!/Read-only development\s+and builds require only `BLOB_BASE_URL`/.test(rootReadme)) {
    issues.push("README.md: read-only setup must state that BLOB_BASE_URL is the only required Blob credential");
  }

  const ops = readFileSync(resolve(root, "docs/OPS.md"), "utf8");
  if (!ops.includes("`web/.env.local`")) issues.push("docs/OPS.md: local env location must be web/.env.local");
  if (/本地用 `\.env`/.test(ops)) issues.push("docs/OPS.md: root .env is not loaded by the web scripts");

  const activeDocs = walk(resolve(root, "docs"))
    .filter((file) => file.endsWith(".md"))
    .filter((file) => !historicalDocumentAllowlist.has(toRepoPath(file, root)));
  for (const file of activeDocs) {
    const content = readFileSync(file, "utf8");
    if (content.includes("web/middleware.ts")) {
      issues.push(`${toRepoPath(file, root)}: stale middleware path; the active entrypoint is web/proxy.ts`);
    }
  }

  return issues;
}

export function checkDocs(root) {
  return [
    ...checkDocReferences(root),
    ...checkEnvironmentInventory(root),
    ...checkMaintainedFacts(root),
  ];
}

function run(root) {
  const issues = checkDocs(root);
  if (issues.length === 0) {
    console.log("Documentation references, environment inventory, and maintained facts are consistent.");
    return true;
  }
  console.error("Documentation consistency checks failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  return false;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath && !run(process.cwd())) process.exitCode = 1;
