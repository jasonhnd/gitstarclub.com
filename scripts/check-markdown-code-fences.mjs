import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
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
      issues.push(`${relative(root, file)}:${index + 1}`);
    }

    fence = {
      close: closingFencePattern(marker[0], marker.length),
    };
  }

  return issues;
}

const issues = listMarkdownFiles(root)
  .filter((file) => statSync(file).isFile())
  .flatMap(checkFile);

if (issues.length > 0) {
  console.error("Markdown code fences must include a language tag:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

