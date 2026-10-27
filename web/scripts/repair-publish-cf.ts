/** One raw-body boundary for the repository-pinned cf. Never downloads a CLI. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify, stripVTControlCharacters } from "node:util";

export type CfRunner = (args: string[], child: { env: NodeJS.ProcessEnv }) => Promise<{
  code: number; stdout: string | Buffer; stderr: string; alreadyPresent?: boolean;
}>;
const execute = promisify(execFile);
export const cfChild = () => ({ env: { ...process.env, CF_DELEGATION: "1" } });
export type CfRetryOptions = {
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  log?: (line: string) => void;
};

/** Supplied only by the owner of a mutable control object. The shared retry
 * boundary still requires exact prior or intended bytes at the exact key. */
export type CfPutReplacementRetry = {
  expectedPrior: Buffer;
  authorize: (state: "prior" | "intended", now: number) => boolean;
};

export function repairConcurrency(value = 4): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10) {
    throw new Error("Concurrency must be an integer from 1 to 10");
  }
  return value;
}

export type ListedObject = { key: string; size: number; etag: string };
export const REPAIR_LIST_PAGE_SIZE = 1000;

/** cf beta.18 prints only the result array; a short page terminates the walk. */
export async function listCfPrefix(runner: CfRunner, prefix: string, bucket: string,
  retry: CfRetryOptions = {}): Promise<Map<string, ListedObject>> {
  const objects = new Map<string, ListedObject>();
  let last = "";
  for (;;) {
    const args = ["r2", "objects", "list", "--bucket-name", bucket,
      "--prefix", prefix, "--per-page", String(REPAIR_LIST_PAGE_SIZE)];
    if (last) args.push("--start-after", last);
    const bytes = await cfBytes(runner, args, retry);
    let page: unknown;
    try { page = JSON.parse(bytes.toString("utf8")); }
    catch { throw new Error(`Invalid cf object listing: ${prefix}`); }
    if (!Array.isArray(page) || page.length > REPAIR_LIST_PAGE_SIZE) throw new Error(`Invalid cf object listing: ${prefix}`);
    for (const entry of page) {
      if (typeof entry?.key !== "string" || !entry.key.startsWith(prefix) || entry.key <= last ||
          !Number.isSafeInteger(entry.size) || entry.size < 0 || typeof entry.etag !== "string" ||
          entry.etag.length === 0 || objects.has(entry.key)) {
        throw new Error(`Invalid cf object listing: ${prefix}`);
      }
      objects.set(entry.key, entry);
      last = entry.key;
    }
    if (page.length < REPAIR_LIST_PAGE_SIZE) return objects;
  }
}

export function matchesListedObject(entry: ListedObject, body: Buffer): boolean {
  const digest = createHash("md5").update(body).digest("hex");
  return entry.size === body.length && (entry.etag === digest || entry.etag === `"${digest}"`);
}

/** Bound actual child calls, including lease renewal during upload retry waits. */
export function limitCfConcurrency(runner: CfRunner, concurrency = 4): CfRunner {
  repairConcurrency(concurrency);
  let active = 0;
  const queue: Array<() => void> = [];
  return async (args, child) => {
    await new Promise<void>((resolve) => {
      const start = () => { active++; resolve(); };
      if (active < concurrency) start(); else queue.push(start);
    });
    try { return await runner(args, child); }
    finally { active--; queue.shift()?.(); }
  };
}

export const runCf: CfRunner = async (args, child) => {
  try {
    const { stdout, stderr } = await execute(fileURLToPath(new URL("../node_modules/.bin/cf", import.meta.url)), args,
      { encoding: "buffer", maxBuffer: 320 * 1024 * 1024, env: { ...child.env, CF_DELEGATION: "1" } });
    return { code: 0, stdout, stderr: stderr.toString("utf8") };
  } catch (error) {
    const failure = error as { code?: unknown; stdout?: Buffer; stderr?: Buffer };
    if (typeof failure.code !== "number") throw error;
    return { code: failure.code, stdout: failure.stdout ?? Buffer.alloc(0), stderr: failure.stderr?.toString("utf8") ?? "" };
  }
};

/** beta.18 Gr + blocks.l: the LAST box line is the authoritative HTTP status.
 * Body messages, numeric API error codes, and hints outside it are not statuses.
 */
function apiErrorLines(stderr: string): string[] {
  const plain = stripVTControlCharacters(stderr).replace(/\r/g, "");
  const boxes = [...plain.matchAll(/^┌ APIError\n([\s\S]*?)\n└\s*$/gm)];
  const box = boxes.at(-1);
  if (!box) return [];
  const lines = box[1].split("\n");
  return lines.every((line) => /^│(?: |$)/.test(line))
    ? lines.map((line) => line.replace(/^│ ?/, "").trim()) : [];
}

/** Gr omits response headers; gateway and 500/10500 errors use the 30-second fallback. */
function transientDelay(lines: string[], now: () => number): { status: string; milliseconds: number } | null {
  const match = /^(429 Too Many Requests|500 Internal Server Error|502 Bad Gateway|503 Service Unavailable|504 Gateway Timeout)(?: · HTTP .+)?$/.exec(lines.at(-1) ?? "");
  if (!match) return null;
  const status = match[1].slice(0, 3);
  if (status === "500" && !/^\[10500\](?:\s|$)/.test(lines[0] ?? "")) return null;
  if (status !== "429") return { status, milliseconds: 30_000 };
  const retryAfter = lines.map((line) => /^Retry-After:\s*(.+)$/i.exec(line)?.[1]).find((value) => value !== undefined);
  if (retryAfter !== undefined) {
    const milliseconds = Number(retryAfter) * 1000;
    if (/^\d+(?:\.\d+)?$/.test(retryAfter) && Number.isFinite(milliseconds)) return { status, milliseconds };
    const date = /^[A-Za-z]{3}, /.test(retryAfter) ? Date.parse(retryAfter) : NaN;
    if (Number.isFinite(date)) return { status, milliseconds: Math.max(0, date - now()) };
  }
  return { status, milliseconds: 30_000 };
}

// Keep the cooldown inside the shared promise so parallel 401s also join while
// cf's refreshed credentials settle. Never retry whoami recursively.
let authRefresh: Promise<void> | undefined;
function refreshCfAuth(runner: CfRunner, sleep: NonNullable<CfRetryOptions["sleep"]>,
  random: () => number, log: (line: string) => void): Promise<void> {
  if (!authRefresh) {
    authRefresh = Promise.resolve().then(async () => {
      log("cf HTTP 401; refreshing authentication with cf auth whoami (shared across parallel calls)");
      const result = await runner(["auth", "whoami"], cfChild());
      if (result.code !== 0) throw new Error(`cf auth whoami failed (${result.code}): ${result.stderr}`);
      let authenticated: unknown;
      try { authenticated = JSON.parse(result.stdout.toString()).authenticated; }
      catch { throw new Error("cf auth whoami returned invalid authentication status"); }
      if (authenticated !== true) throw new Error("cf auth whoami is not authenticated");
      const milliseconds = 3000 + Math.floor(random() * 1000);
      log(`cf authentication refresh complete; waiting ${(milliseconds / 1000).toFixed(3)} seconds before retry`);
      await sleep(milliseconds);
    }).finally(() => { authRefresh = undefined; });
  }
  return authRefresh;
}

/** Pinned cf lists an array without pagination metadata. Only exact matches
 * prove presence; a full page without the key cannot prove absence.
 */
async function cfObjectListing(runner: CfRunner, key: string, bucket: string, retry: CfRetryOptions): Promise<Array<{ key: string; size?: unknown; etag?: unknown }>> {
  const page = JSON.parse((await cfBytes(runner, ["r2", "objects", "list", "--bucket-name", bucket,
    "--prefix", key, "--per-page", "1000"], retry)).toString("utf8"));
  if (!Array.isArray(page) || page.length > 1000 ||
      page.some((entry) => typeof entry?.key !== "string" || !entry.key.startsWith(key))) {
    throw new Error("Invalid cf object listing");
  }
  return page;
}

export async function cfObjectExists(runner: CfRunner, key: string, bucket: string, retry: CfRetryOptions = {}): Promise<boolean> {
  const page = await cfObjectListing(runner, key, bucket, retry);
  if (page.some((entry) => entry.key === key)) return true;
  if (page.length === 1000) throw new Error(`Incomplete cf object listing: ${key}`);
  return false;
}

async function cfObjectAtKey(runner: CfRunner, key: string, bucket: string, retry: CfRetryOptions): Promise<ListedObject | undefined> {
  const page = await cfObjectListing(runner, key, bucket, retry);
  const exact = page.filter((entry) => entry.key === key);
  if (exact.length > 1 || exact.length === 1 &&
      (!Number.isSafeInteger(exact[0].size) || (exact[0].size as number) < 0 ||
       typeof exact[0].etag !== "string" || exact[0].etag.length === 0)) {
    throw new Error(`Invalid cf object listing: ${key}`);
  }
  if (exact.length === 1) return exact[0] as ListedObject;
  if (page.length === 1000) throw new Error(`Incomplete cf object listing: ${key}`);
  return undefined;
}

/** One retry boundary for every publisher caller, including injected runners. */
export async function cfResult(runner: CfRunner, args: string[], retry: CfRetryOptions = {},
  replacement?: CfPutReplacementRetry): Promise<Awaited<ReturnType<CfRunner>>> {
  const { sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)), random = Math.random,
    now = Date.now, log = console.error } = retry;
  const operation = args[2];
  const key = operation === "list" ? args[args.indexOf("--prefix") + 1] : args[3];
  const bucketAt = args.indexOf("--bucket-name"), fileAt = args.indexOf("--file");
  // Snapshot the intended bytes before the first attempt, including control puts.
  const body = operation === "put" && fileAt >= 0 ? await readFile(args[fileAt + 1]) : undefined;
  const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");
  let transientRetries = 0, authRetried = false;
  for (;;) {
    const result = await runner(args, cfChild());
    if (result.code === 0) return result;
    const lines = apiErrorLines(result.stderr);
    let recheckEtag = false;
    if (/^\[10000\](?:\s|$)/.test(lines[0] ?? "") &&
        /^401 Unauthorized(?: · HTTP .+)?$/.test(lines.at(-1) ?? "")) {
      const loginHint = "Run cf auth login and rerun the publisher (rerun is safe).";
      if (authRetried) throw new Error(`cf ${operation} ${key} failed: HTTP 401 after authentication retry. ${loginHint}\n${result.stderr}`);
      authRetried = true;
      try { await refreshCfAuth(runner, sleep, random, log); }
      catch (error) { throw new Error(`cf ${operation} ${key} authentication refresh failed. ${loginHint}`, { cause: error }); }
      log(`cf ${operation} key=${key} HTTP 401; retry 1/1 after authentication refresh`);
    } else {
      const transient = transientDelay(lines, now);
      if (transient === null) throw new Error(`cf ${operation} failed (${result.code}): ${result.stderr}`);
      if (transientRetries === 6) throw new Error(`cf ${operation} ${key} failed: HTTP ${transient.status} after 6 retries: ${result.stderr}`);
      recheckEtag = transient.status === "500";
      const milliseconds = transient.milliseconds + Math.floor(random() * 1000);
      log(`cf ${operation} key=${key} HTTP ${transient.status}; retry ${++transientRetries}/6; waiting ${(milliseconds / 1000).toFixed(3)} seconds`);
      await sleep(milliseconds);
    }
    if (operation === "put") {
      if (!body || bucketAt < 0 || !args[bucketAt + 1]) throw new Error(`Cannot safely retry cf put: ${key}`);
      const bucket = args[bucketAt + 1];
      if (replacement) {
        const present = await cfObjectAtKey(runner, key, bucket, retry);
        if (!present) throw new Error(`Owned replacement key disappeared: ${key}`);
        const actual = await cfBytes(runner, ["r2", "objects", "get", key, "--bucket-name", bucket], retry);
        const current = await readFile(args[fileAt + 1]);
        if (!current.equals(body)) throw new Error(`Local put bytes changed during retry: ${key}`);
        if (actual.equals(body) && replacement.authorize("intended", now())) {
          return { code: 0, stdout: Buffer.alloc(0), stderr: "", alreadyPresent: true };
        }
        if (!actual.equals(replacement.expectedPrior) || !replacement.authorize("prior", now())) {
          throw new Error(`Existing object differs: ${key}`);
        }
      } else if (recheckEtag) {
        const present = await cfObjectAtKey(runner, key, bucket, retry);
        if (present) {
          if (!matchesListedObject(present, body)) throw new Error(`Existing object differs: ${key}`);
          return { code: 0, stdout: Buffer.alloc(0), stderr: "", alreadyPresent: true };
        }
      } else if (await cfObjectExists(runner, key, bucket, retry)) {
        const actual = await cfBytes(runner, ["r2", "objects", "get", key, "--bucket-name", bucket], retry);
        if (actual.length !== body.length || sha256(actual) !== sha256(body)) throw new Error(`Existing object differs: ${key}`);
        return { code: 0, stdout: Buffer.alloc(0), stderr: "", alreadyPresent: true };
      }
      const current = await readFile(args[fileAt + 1]);
      if (!current.equals(body)) throw new Error(`Local put bytes changed during retry: ${key}`);
    }
  }
}

export async function cfBytes(runner: CfRunner, args: string[], retry: CfRetryOptions = {}): Promise<Buffer> {
  const result = await cfResult(runner, args, retry);
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout);
}
