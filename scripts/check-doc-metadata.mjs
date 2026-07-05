import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const docsRoot = path.join(process.cwd(), "docs");
const requiredFields = ["owner", "status", "last_reviewed", "source_of_truth_for"];
const allowedStatuses = new Set(["active", "historical", "draft", "superseded"]);

async function listMarkdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return listMarkdownFiles(fullPath);
      }
      return entry.isFile() && entry.name.endsWith(".md") ? [fullPath] : [];
    }),
  );
  return files.flat().sort();
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    return null;
  }

  const fields = new Map();
  let currentKey = null;

  for (const line of match[1].split(/\r?\n/)) {
    const keyMatch = line.match(/^([a-z_]+):(?:\s+(.*))?$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      const value = keyMatch[2] ?? "";
      fields.set(currentKey, value === "" ? [] : value);
      continue;
    }

    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch && currentKey) {
      const value = fields.get(currentKey);
      fields.set(currentKey, Array.isArray(value) ? [...value, listMatch[1]] : [value, listMatch[1]]);
    }
  }

  return fields;
}

function isPresent(value) {
  if (Array.isArray(value)) {
    return value.some((item) => item.trim().length > 0);
  }
  return typeof value === "string" && value.trim().length > 0;
}

const files = await listMarkdownFiles(docsRoot);
const errors = [];

for (const file of files) {
  const relativePath = path.relative(process.cwd(), file).replaceAll(path.sep, "/");
  const frontmatter = parseFrontmatter(await readFile(file, "utf8"));

  if (!frontmatter) {
    errors.push(`${relativePath}: missing YAML frontmatter`);
    continue;
  }

  for (const field of requiredFields) {
    if (!isPresent(frontmatter.get(field))) {
      errors.push(`${relativePath}: missing required metadata field "${field}"`);
    }
  }

  const status = frontmatter.get("status");
  if (typeof status === "string" && !allowedStatuses.has(status)) {
    errors.push(`${relativePath}: status must be one of ${[...allowedStatuses].join(", ")}`);
  }

  const lastReviewed = frontmatter.get("last_reviewed");
  if (typeof lastReviewed === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(lastReviewed)) {
    errors.push(`${relativePath}: last_reviewed must use YYYY-MM-DD`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Checked metadata for ${files.length} docs.`);
