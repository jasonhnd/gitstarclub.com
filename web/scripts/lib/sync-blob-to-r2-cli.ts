export type SyncBlobToR2Args = {
  execute: boolean;
  sourcePrefix: string;
};

export function parseSyncBlobToR2Args(argv: readonly string[]): SyncBlobToR2Args {
  const execute = argv.includes("--execute");
  const prefixIndex = argv.indexOf("--prefix");
  const sourcePrefix = prefixIndex >= 0 ? (argv[prefixIndex + 1] ?? "") : "";
  return { execute, sourcePrefix };
}

export function missingBlobTokenOutcome(execute: boolean): { log: string; error: string | null } {
  return {
    log: "dry-run listing skipped: BLOB_READ_WRITE_TOKEN is not set.",
    error: execute ? "BLOB_READ_WRITE_TOKEN is required for --execute" : null,
  };
}
