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

export function repairConcurrency(value = 4): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 32) {
    throw new Error("Concurrency must be an integer from 1 to 32");
  }
  return value;
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

/** Gr omits response headers, so real beta.18 usually needs 30 seconds. */
function rateLimitDelay(lines: string[], now: () => number): number | null {
  if (!/^429 Too Many Requests(?: · HTTP .+)?$/.test(lines.at(-1) ?? "")) return null;
  const retryAfter = lines.map((line) => /^Retry-After:\s*(.+)$/i.exec(line)?.[1]).find((value) => value !== undefined);
  if (retryAfter !== undefined) {
    const milliseconds = Number(retryAfter) * 1000;
    if (/^\d+(?:\.\d+)?$/.test(retryAfter) && Number.isFinite(milliseconds)) return milliseconds;
    const date = /^[A-Za-z]{3}, /.test(retryAfter) ? Date.parse(retryAfter) : NaN;
    if (Number.isFinite(date)) return Math.max(0, date - now());
  }
  return 30_000;
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
export async function cfObjectExists(runner: CfRunner, key: string, bucket: string, retry: CfRetryOptions = {}): Promise<boolean> {
  const page = JSON.parse((await cfBytes(runner, ["r2", "objects", "list", "--bucket-name", bucket,
    "--prefix", key, "--per-page", "1000"], retry)).toString("utf8"));
  if (!Array.isArray(page) || page.length > 1000 ||
      page.some((entry) => typeof entry?.key !== "string" || !entry.key.startsWith(key))) {
    throw new Error("Invalid cf object listing");
  }
  if (page.some((entry) => entry.key === key)) return true;
  if (page.length === 1000) throw new Error(`Incomplete cf object listing: ${key}`);
  return false;
}

/** One retry boundary for every publisher caller, including injected runners. */
export async function cfResult(runner: CfRunner, args: string[], retry: CfRetryOptions = {}): Promise<Awaited<ReturnType<CfRunner>>> {
  const { sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)), random = Math.random,
    now = Date.now, log = console.error } = retry;
  const operation = args[2];
  const key = operation === "list" ? args[args.indexOf("--prefix") + 1] : args[3];
  const bucketAt = args.indexOf("--bucket-name"), fileAt = args.indexOf("--file");
  // Snapshot the intended bytes before the first attempt, including control puts.
  const body = operation === "put" && fileAt >= 0 ? await readFile(args[fileAt + 1]) : undefined;
  const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");
  let rateLimitRetries = 0, authRetried = false;
  for (;;) {
    const result = await runner(args, cfChild());
    if (result.code === 0) return result;
    const lines = apiErrorLines(result.stderr);
    if (/^\[10000\](?:\s|$)/.test(lines[0] ?? "") &&
        /^401 Unauthorized(?: · HTTP .+)?$/.test(lines.at(-1) ?? "")) {
      const loginHint = "Run cf auth login and rerun the publisher (rerun is safe).";
      if (authRetried) throw new Error(`cf ${operation} ${key} failed: HTTP 401 after authentication retry. ${loginHint}\n${result.stderr}`);
      authRetried = true;
      try { await refreshCfAuth(runner, sleep, random, log); }
      catch (error) { throw new Error(`cf ${operation} ${key} authentication refresh failed. ${loginHint}`, { cause: error }); }
      log(`cf ${operation} key=${key} HTTP 401; retry 1/1 after authentication refresh`);
    } else {
      const delay = rateLimitDelay(lines, now);
      if (delay === null) throw new Error(`cf ${operation} failed (${result.code}): ${result.stderr}`);
      if (rateLimitRetries === 6) throw new Error(`cf ${operation} ${key} failed: HTTP 429 after 6 retries: ${result.stderr}`);
      const milliseconds = delay + Math.floor(random() * 1000);
      log(`cf ${operation} key=${key} HTTP 429; retry ${++rateLimitRetries}/6; waiting ${(milliseconds / 1000).toFixed(3)} seconds`);
      await sleep(milliseconds);
    }
    if (operation === "put") {
      if (!body || bucketAt < 0 || !args[bucketAt + 1]) throw new Error(`Cannot safely retry cf put: ${key}`);
      const bucket = args[bucketAt + 1];
      if (await cfObjectExists(runner, key, bucket, retry)) {
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
