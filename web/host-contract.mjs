/** Public, non-secret deployment contract. No platform queries or side effects. */
export const accountId = "00f850e853e4c7f9627233d51a6e30a1";
export const hostModes = Object.freeze({
  production: {
    name: "gitstarclub-web", bucket: "gitstarclub-data-prod", queue: "gitstarclub-jobs",
    workersDev: false, previewUrls: false,
    vars: {
      HOSTING_TARGET: "cf", SITE_INDEXABLE: "1", NEXT_PUBLIC_SITE_URL: "https://gitstarclub.com",
      CF_CRON_ORIGIN: "https://gitstarclub.com", DEPLOY_ENV: "production",
      STORAGE_READ_DRIVER: "r2", STORAGE_WRITE_DRIVER: "r2_binding",
      R2_BUCKET: "gitstarclub-data-prod", R2_PUBLIC_BASE_URL: "https://data.gitstarclub.com",
      WORKFLOW_RUNTIME: "cf-queue", WORKFLOW_QUEUE_ENQUEUE_URL: "https://gitstarclub.com/enqueue",
      VIEWS_VERSION_FALLBACK: "refresh-2026-09-13T06-00-16-398Z",
    },
  },
  pre: {
    name: "gitstarclub-web-pre", bucket: "gitstarclub-data-pre", queue: "gitstarclub-jobs-pre",
    workersDev: true, previewUrls: true,
    vars: {
      HOSTING_TARGET: "cf", SITE_INDEXABLE: "0", NEXT_PUBLIC_SITE_URL: "https://gitstarclub.com",
      CF_CRON_ORIGIN: "https://pre.gitstarclub.com", DEPLOY_ENV: "pre",
      STORAGE_READ_DRIVER: "r2", STORAGE_WRITE_DRIVER: "r2_binding",
      R2_BUCKET: "gitstarclub-data-pre", R2_PUBLIC_BASE_URL: "https://data-pre.gitstarclub.com",
      WORKFLOW_RUNTIME: "cf-queue", WORKFLOW_QUEUE_ENQUEUE_URL: "https://pre.gitstarclub.com/enqueue",
      MIN_TRACKED_STARS: "10000", WHITELIST_SEARCH_SHARDS: "1",
      WORKFLOW_COLD_START: "1", PREFLIGHT_RELAX_EMPTY_SHARDS: "1",
    },
  },
});

export function hostMode(mode) {
  if (mode !== "pre" && mode !== "production") throw new Error("Select explicit mode pre or production");
  return hostModes[mode];
}

export function loopbackBase(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

/** @param {string} mode @param {Record<string, string | undefined>} env @returns {Record<string, string>} */
export function buildVars(mode, env = process.env) {
  const target = hostMode(mode);
  for (const key of ["R2_PUBLIC_BASE_URL", "NEXT_PUBLIC_R2_PUBLIC_BASE_URL", "BLOB_BASE_URL", "NEXT_PUBLIC_BLOB_BASE_URL"]) {
    const value = env[key]?.replace(/\/+$/, "");
    if (value && key.includes("BLOB") && !loopbackBase(value)) throw new Error(`${mode} refuses nonlocal Blob build variables`);
    if (value && !loopbackBase(value) && value !== target.vars.R2_PUBLIC_BASE_URL) {
      throw new Error(`${mode} refuses conflicting ${key}`);
    }
  }
  const fixture = env.BLOB_BASE_URL;
  if (fixture && loopbackBase(fixture)) {
    return { ...target.vars, STORAGE_READ_DRIVER: "blob", BLOB_BASE_URL: fixture, VIEWS_VERSION_FALLBACK: "" };
  }
  return target.vars;
}
