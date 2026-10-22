export const AGGREGATE_IMPORT_PATH = "/preview/aggregate-history-import";
export const PREVIEW_BUCKET = "gitstarclub-data-pre";
export const AGGREGATE_MANIFEST_SHA256 = "b9015837a501fa732192f3d43d27114a8f6ef46f627a9c68569d4a0b3fff0f49";

/** Configuration is only the first guard; the bound bucket marker is checked on every call. */
export function aggregateImportEnabled(env: { DEPLOY_ENV?: string; R2_BUCKET?: string }): boolean {
  return env.DEPLOY_ENV === "pre" && env.R2_BUCKET === PREVIEW_BUCKET;
}
