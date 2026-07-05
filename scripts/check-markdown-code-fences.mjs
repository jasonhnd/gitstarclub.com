import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const requiredDocMetadataFields = [
  "owner",
  "status",
  "last_reviewed",
  "source_of_truth_for",
];
const allowedDocStatuses = new Set([
  "active",
  "historical",
  "baseline",
  "draft",
  "superseded",
]);
const ignoredDirs = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "node_modules",
]);

function listMarkdownFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        files.push(...listMarkdownFiles(path));
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path);
    }
  }

  return files;
}

function closingFencePattern(char, length) {
  const escaped = char === "`" ? "`" : "\\~";
  return new RegExp(`^ {0,3}${escaped}{${length},}\\s*$`);
}

function repoPath(file) {
  return relative(root, file).replaceAll("\\", "/");
}

function checkFile(file) {
  const content = readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);
  const issues = [];
  let fence = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (fence) {
      if (fence.close.test(line)) {
        fence = null;
      }
      continue;
    }

    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!match) {
      continue;
    }

    const marker = match[1];
    const info = match[2].trim();
    if (!info) {
      issues.push(`${repoPath(file)}:${index + 1}`);
    }

    fence = {
      close: closingFencePattern(marker[0], marker.length),
    };
  }

  return issues;
}

function checkDocMetadata(file) {
  const content = readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);
  const path = repoPath(file);
  const issues = [];

  if (lines[0] !== "---") {
    return [`${path}:1 missing docs metadata frontmatter`];
  }

  const end = lines.findIndex((line, index) => index > 0 && line === "---");
  if (end === -1) {
    return [`${path}:1 unterminated docs metadata frontmatter`];
  }

  const fields = new Map();
  for (let index = 1; index < end; index += 1) {
    const match = lines[index].match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (match) {
      fields.set(match[1], {
        line: index + 1,
        value: match[2].trim(),
      });
    }
  }

  for (const field of requiredDocMetadataFields) {
    if (!fields.has(field)) {
      issues.push(`${path}:1 missing docs metadata field: ${field}`);
    }
  }

  const status = fields.get("status");
  if (status && !allowedDocStatuses.has(status.value)) {
    issues.push(
      `${path}:${status.line} unsupported docs metadata status: ${status.value}`,
    );
  }

  const lastReviewed = fields.get("last_reviewed");
  if (lastReviewed && !/^\d{4}-\d{2}-\d{2}$/.test(lastReviewed.value)) {
    issues.push(
      `${path}:${lastReviewed.line} last_reviewed must use YYYY-MM-DD`,
    );
  }

  return issues;
}

const markdownFiles = listMarkdownFiles(root).filter((file) =>
  statSync(file).isFile(),
);
const codeFenceIssues = markdownFiles.flatMap(checkFile);
const metadataIssues = markdownFiles
  .filter((file) => repoPath(file).startsWith("docs/"))
  .flatMap(checkDocMetadata);

if (codeFenceIssues.length > 0) {
  console.error("Markdown code fences must include a language tag:");
  for (const issue of codeFenceIssues) {
    console.error(`- ${issue}`);
  }
}

if (metadataIssues.length > 0) {
  console.error("Docs markdown files must include metadata frontmatter:");
  for (const issue of metadataIssues) {
    console.error(`- ${issue}`);
  }
}

if (codeFenceIssues.length > 0 || metadataIssues.length > 0) {
  process.exit(1);
}

