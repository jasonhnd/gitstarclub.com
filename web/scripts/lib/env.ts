import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type EnvTarget = Record<string, string | undefined>;

export type EnvFileDiagnostic = {
  path: string;
  line: number;
  message: string;
};

export type EnvFileEntry = {
  path: string;
  line: number;
  key: string;
  value: string;
};

export type ParseEnvFileResult = {
  entries: EnvFileEntry[];
  diagnostics: EnvFileDiagnostic[];
};

export type LoadEnvFilesOptions = {
  rootDir: string;
  names: readonly string[];
  keys?: readonly string[];
  target?: EnvTarget;
  override?: boolean;
  onDiagnostic?: (diagnostic: EnvFileDiagnostic) => void;
};

export type LoadEnvFilesResult = {
  files: string[];
  loadedKeys: string[];
  diagnostics: EnvFileDiagnostic[];
};

export const WEB_ENV_FILE_NAMES = [".env.local"] as const;

export function envFilePaths(rootDir: string, names: readonly string[]): string[] {
  return names.map((name) => join(rootDir, name)).filter((path) => existsSync(path));
}

export function parseEnvFile(content: string, path = "<env>"): ParseEnvFileResult {
  const entries: EnvFileEntry[] = [];
  const diagnostics: EnvFileDiagnostic[] = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
    const eq = normalized.indexOf("=");
    if (eq <= 0) {
      diagnostics.push({
        path,
        line: lineNumber,
        message: "Expected KEY=value or export KEY=value; skipping line.",
      });
      continue;
    }

    const key = normalized.slice(0, eq).trim();
    entries.push({
      path,
      line: lineNumber,
      key,
      value: unquoteEnvValue(normalized.slice(eq + 1)),
    });
  }

  return { entries, diagnostics };
}

export function loadEnvFiles(options: LoadEnvFilesOptions): LoadEnvFilesResult {
  const target = options.target ?? process.env;
  const files = envFilePaths(options.rootDir, options.names);
  const allowedKeys = options.keys ? new Set<string>(options.keys) : null;
  const loadedKeys: string[] = [];
  const diagnostics: EnvFileDiagnostic[] = [];

  for (const path of files) {
    const parsed = parseEnvFile(readFileSync(path, "utf8"), path);
    diagnostics.push(...parsed.diagnostics);
    for (const diagnostic of parsed.diagnostics) options.onDiagnostic?.(diagnostic);

    for (const entry of parsed.entries) {
      if (allowedKeys && !allowedKeys.has(entry.key)) continue;
      if (!options.override && target[entry.key] !== undefined) continue;
      target[entry.key] = entry.value;
      loadedKeys.push(entry.key);
    }
  }

  return { files, loadedKeys, diagnostics };
}

export function loadWebEnvFiles(
  rootDir: string,
  options: Omit<LoadEnvFilesOptions, "rootDir" | "names"> = {},
): LoadEnvFilesResult {
  return loadEnvFiles({ ...options, rootDir, names: WEB_ENV_FILE_NAMES });
}

export function formatEnvFileDiagnostic(diagnostic: EnvFileDiagnostic): string {
  return `${diagnostic.path}:${diagnostic.line}: ${diagnostic.message}`;
}

export function warnEnvFileDiagnostic(diagnostic: EnvFileDiagnostic): void {
  console.warn(formatEnvFileDiagnostic(diagnostic));
}

function unquoteEnvValue(raw: string): string {
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
