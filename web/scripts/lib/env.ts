import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type EnvFileDiagnostic = {
  file: string;
  line: number;
  message: string;
  source: string;
};

export type LoadEnvFilesOptions = {
  files: readonly string[];
  keys?: readonly string[];
  env?: Record<string, string | undefined>;
  override?: boolean;
};

export type LoadedEnvFile = {
  file: string;
  applied: string[];
  skippedExisting: string[];
};

export type LoadEnvFilesResult = {
  files: LoadedEnvFile[];
  diagnostics: EnvFileDiagnostic[];
};

type ParsedEnvLine =
  | {
      kind: "entry";
      key: string;
      value: string;
    }
  | {
      kind: "diagnostic";
      diagnostic: EnvFileDiagnostic;
    }
  | null;

export function scriptEnvFiles(webDir: string): string[] {
  return [join(webDir, ".env.local")];
}

export function loadScriptEnvFiles(
  webDir: string,
  options: Omit<LoadEnvFilesOptions, "files"> = {},
): LoadEnvFilesResult {
  return loadEnvFiles({ ...options, files: scriptEnvFiles(webDir) });
}

export function loadEnvFiles({
  files,
  keys,
  env = process.env,
  override = false,
}: LoadEnvFilesOptions): LoadEnvFilesResult {
  const diagnostics: EnvFileDiagnostic[] = [];
  const loadedFiles: LoadedEnvFile[] = [];
  const allowedKeys = keys ? new Set<string>(keys) : null;

  for (const file of files) {
    if (!existsSync(file)) continue;

    const loaded: LoadedEnvFile = { file, applied: [], skippedExisting: [] };
    loadedFiles.push(loaded);

    const raw = readFileSync(file, "utf8");
    const lines = raw.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const parsed = parseEnvLine(lines[index], file, index + 1);
      if (!parsed) continue;
      if (parsed.kind === "diagnostic") {
        diagnostics.push(parsed.diagnostic);
        continue;
      }
      if (allowedKeys && !allowedKeys.has(parsed.key)) continue;
      if (!override && env[parsed.key] !== undefined) {
        loaded.skippedExisting.push(parsed.key);
        continue;
      }

      env[parsed.key] = parsed.value;
      loaded.applied.push(parsed.key);
    }
  }

  return { files: loadedFiles, diagnostics };
}

function parseEnvLine(rawLine: string, file: string, lineNumber: number): ParsedEnvLine {
  const raw = lineNumber === 1 ? rawLine.replace(/^\uFEFF/, "") : rawLine;
  const line = raw.trim();
  if (!line || line.startsWith("#")) return null;

  const normalized = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
  const eq = normalized.indexOf("=");
  if (eq < 0) {
    return malformed(file, lineNumber, raw, "Expected KEY=VALUE.");
  }

  const key = normalized.slice(0, eq).trim();
  if (!key) {
    return malformed(file, lineNumber, raw, "Expected a non-empty key before =.");
  }

  return {
    kind: "entry",
    key,
    value: unquoteEnvValue(normalized.slice(eq + 1)),
  };
}

function malformed(file: string, line: number, source: string, message: string): ParsedEnvLine {
  return {
    kind: "diagnostic",
    diagnostic: {
      file,
      line,
      source,
      message,
    },
  };
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
