import { existsSync, readFileSync } from "node:fs";

export interface EnvAssignment {
  key: string;
  value: string;
  lineNumber: number;
}

export interface MalformedEnvLine {
  lineNumber: number;
  line: string;
  reason: string;
}

export interface LoadEnvFileOptions {
  envPath: string;
  keys?: readonly string[];
  env?: Record<string, string | undefined>;
  overwriteExisting?: boolean;
  treatEmptyAsMissing?: boolean;
}

export interface LoadEnvFileResult {
  loaded: string[];
  malformed: MalformedEnvLine[];
  found: boolean;
}

export function unquoteEnvValue(raw: string): string {
  let value = raw.trim();
  const quote = value[0];
  if ((quote === `"` || quote === `'`) && value.endsWith(quote)) {
    value = value.slice(1, -1);
    if (quote === `"`) value = value.replaceAll("\\n", "\n").replaceAll("\\r", "\r");
  } else {
    value = value.replace(/\s+#.*$/, "").trim();
  }
  return value;
}

export function parseEnvFile(content: string): { assignments: EnvAssignment[]; malformed: MalformedEnvLine[] } {
  const assignments: EnvAssignment[] = [];
  const malformed: MalformedEnvLine[] = [];
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index];
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
    const eq = normalized.indexOf("=");
    if (eq <= 0) {
      malformed.push({ lineNumber, line: rawLine, reason: "missing key/value separator" });
      continue;
    }

    const key = normalized.slice(0, eq).trim();
    if (!key) {
      malformed.push({ lineNumber, line: rawLine, reason: "missing key" });
      continue;
    }

    assignments.push({ key, value: unquoteEnvValue(normalized.slice(eq + 1)), lineNumber });
  }

  return { assignments, malformed };
}

export function loadEnvFile(options: LoadEnvFileOptions): LoadEnvFileResult {
  const env = options.env ?? process.env;
  if (!existsSync(options.envPath)) return { loaded: [], malformed: [], found: false };

  const parsed = parseEnvFile(readFileSync(options.envPath, "utf8"));
  const allowed = options.keys ? new Set(options.keys) : null;
  const loaded: string[] = [];

  for (const assignment of parsed.assignments) {
    if (allowed && !allowed.has(assignment.key)) continue;
    const current = env[assignment.key];
    const missing = current === undefined || (options.treatEmptyAsMissing === true && current === "");
    if (!options.overwriteExisting && !missing) continue;
    env[assignment.key] = assignment.value;
    loaded.push(assignment.key);
  }

  return { loaded, malformed: parsed.malformed, found: true };
}
