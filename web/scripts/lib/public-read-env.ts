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
  return getPublicReadBases(process.env).map((raw) => {
    const value = raw.trim();
    const base = new URL(value.endsWith("/") ? value : `${value}/`);
    if (base.protocol !== "https:" && base.protocol !== "http:") {
      throw new Error("The storage public read base must be an http(s) URL.");
    }
    return base;
  });
}
