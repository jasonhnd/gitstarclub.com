import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type DocIssue = {
  file: string;
  line?: number;
  message: string;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..");
const ignoredDirs = new Set([".git", ".next", "node_modules"]);
const requiredMetadata = ["owner", "status", "last_reviewed", "source_of_truth_for"];
const allowedStatuses = new Set(["active", "baseline", "draft", "historical", "superseded"]);

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) files.push(...walk(join(dir, entry.name)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(join(dir, entry.name));
  }

  return files;
}

function toRepoPath(file: string): string {
  return relative(repoRoot, file).replace(/\\/g, "/");
}

function checkCodeFences(file: string, text: string, issues: DocIssue[]) {
  const lines = text.split("\n");
  let fenceMarker: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^(```+)(.*)$/);
    if (!match) continue;

    const marker = match[1];
    const info = match[2].trim();

    if (fenceMarker === null) {
      if (!info) {
        issues.push({
          file,
          line: index + 1,
          message: "code fence opening is missing an info string",
        });
      }
      fenceMarker = marker;
      continue;
    }

    if (marker.length >= fenceMarker.length) fenceMarker = null;
  }

  if (fenceMarker !== null) {
    issues.push({ file, message: "code fence was opened but not closed" });
  }
}

function frontmatterOf(text: string): string | null {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return null;
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) return null;
  return normalized.slice(4, end);
}

function checkDocMetadata(file: string, text: string, issues: DocIssue[]) {
  const metadata = frontmatterOf(text);
  if (metadata === null) {
    issues.push({ file, message: "docs file is missing YAML frontmatter metadata" });
    return;
  }

  for (const key of requiredMetadata) {
    if (!new RegExp(`^${key}:`, "m").test(metadata)) {
      issues.push({ file, message: `metadata is missing ${key}` });
    }
  }

  const status = metadata.match(/^status:\s*([a-z-]+)/m)?.[1];
  if (status && !allowedStatuses.has(status)) {
    issues.push({ file, message: `metadata status '${status}' is not one of ${[...allowedStatuses].join(", ")}` });
  }

  const lastReviewed = metadata.match(/^last_reviewed:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/m)?.[1];
  if (!lastReviewed) {
    issues.push({ file, message: "metadata last_reviewed must use YYYY-MM-DD" });
  }
}

const issues: DocIssue[] = [];

for (const absoluteFile of walk(repoRoot)) {
  const file = toRepoPath(absoluteFile);
  const text = readFileSync(absoluteFile, "utf8");
  checkCodeFences(file, text.replace(/\r\n/g, "\n"), issues);

  if (file.startsWith("docs/")) {
    checkDocMetadata(file, text, issues);
  }
}

if (issues.length > 0) {
  for (const issue of issues) {
    const location = issue.line ? `${issue.file}:${issue.line}` : issue.file;
    console.error(`${location} - ${issue.message}`);
  }
  process.exit(1);
}

console.log("Documentation checks passed.");
