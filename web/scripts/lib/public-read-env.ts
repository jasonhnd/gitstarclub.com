import { getPublicReadBases } from "../../lib/runtime-config";
import { loadWebEnvFiles, warnEnvFileDiagnostic } from "./env";

const PUBLIC_READ_ENV_KEYS = [
  "STORAGE_READ_DRIVER",
  "READ_DRIVER",
  "R2_PUBLIC_BASE_URL",
  "BLOB_BASE_URL",
  "NEXT_PUBLIC_BLOB_BASE_URL",
] as const;

/** Load only read configuration; shell values retain precedence over local files. */
export function loadPublicReadBases(webDir: string): URL[] {
  loadWebEnvFiles(webDir, {
    keys: PUBLIC_READ_ENV_KEYS,
    onDiagnostic: warnEnvFileDiagnostic,
  });
  // Match the CLIs' existing first-nonblank Blob URL behavior, and ensure the
  // data library uses the same normalized bases that were validated here.
  for (const key of ["R2_PUBLIC_BASE_URL", "BLOB_BASE_URL", "NEXT_PUBLIC_BLOB_BASE_URL"]) {
    if (process.env[key] === undefined) continue;
    const value = process.env[key]?.trim();
    if (value) process.env[key] = value;
    else delete process.env[key];
  }
  return getPublicReadBases(process.env).map((raw) => {
    const value = raw.trim();
    const base = new URL(value.endsWith("/") ? value : `${value}/`);
    if (base.protocol !== "https:" && base.protocol !== "http:") {
      throw new Error("The storage public read base must be an http(s) URL.");
    }
    return base;
  });
}
