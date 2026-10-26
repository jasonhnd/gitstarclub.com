import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cfBytes, limitCfConcurrency, type CfRetryOptions, type CfRunner } from "../scripts/repair-publish-cf";
import { resolvePublishTarget } from "../scripts/repair-publish-target";

const scratch: string[] = [];
afterEach(() => { for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true }); });
const ok = (stdout: string | Buffer = "") => ({ code: 0, stdout, stderr: "" });

// cf beta.18 src Gr + blocks.l: raw APIError box, optional code and ANSI,
// authoritative status LAST. Gr omits headers; Retry-After below models an
// exposed header in the message, not a header that beta.18 normally prints.
function boxedCfError({ status = 429, colour = false, fallback = false, retryAfter,
  message = "Rate limit exceeded", code = 10000, http = true }: {
  status?: number; colour?: boolean; fallback?: boolean; retryAfter?: string;
  message?: string; code?: number; http?: boolean;
} = {}) {
  const paint = (text: string) => colour ? `\u001b[31m\u001b[1m${text}\u001b[22m\u001b[39m` : text;
  const reason = status === 429 ? "Too Many Requests" : status === 500 ? "Internal Server Error" : "Not Found";
  const body = fallback ? `Status code: ${status}\nBody: {"message":${JSON.stringify(message)}}` : `[${code}] ${message}`;
  return `\n${paint("┌")} ${paint("APIError")}\n`
    + [body, ...(retryAfter === undefined ? [] : [`Retry-After: ${retryAfter}`]),
      `${status} ${reason}${http ? " · HTTP /accounts/fake/r2/buckets/fake/objects/key" : ""}`]
      .join("\n").split("\n").map((line) => `${paint("│")} ${paint(line)}`).join("\n")
    + `\n${paint("└")}\n`;
}
const rejected = (options?: Parameters<typeof boxedCfError>[0]) => ({ code: 1, stdout: "", stderr: boxedCfError(options) });
function timing() {
  const waits: number[] = [], logs: string[] = [];
  const retry: CfRetryOptions = { sleep: async (ms) => { waits.push(ms); }, random: () => 0.25,
    now: () => Date.parse("2026-10-26T12:00:00Z"), log: (line) => logs.push(line) };
  return { retry, waits, logs };
}
const get = ["r2", "objects", "get", "key", "--bucket-name", "fake"];

describe("shared repair cf rate limits with fake runners only", () => {
  for (const operation of ["get", "list"]) for (const colour of [false, true]) for (const fallback of [false, true]) {
    test(`${operation} retries the identical call: colour=${colour}, fallback=${fallback}`, async () => {
      const t = timing(), calls: string[][] = [];
      const args = operation === "get" ? get : ["r2", "objects", "list", "--prefix", "key", "--bucket-name", "fake"];
      const runner: CfRunner = async (args, child) => {
        expect(child.env.CF_DELEGATION).toBe("1");
        calls.push([...args]);
        return calls.length === 1 ? rejected({ colour, fallback }) : ok(Buffer.from([0, 255, 128]));
      };
      expect(await cfBytes(runner, args, t.retry)).toEqual(Buffer.from([0, 255, 128]));
      expect(calls).toEqual([args, args]); expect(t.waits).toEqual([30_250]);
      expect(t.logs).toEqual([`cf ${operation} key=key HTTP 429; retry 1/6; waiting 30.250 seconds`]);
    });
  }

  for (const [retryAfter, expected] of [["28", 28_250], ["0", 250], ["Wed, 26 Oct 2026 12:00:28 GMT", 28_250],
    ["invalid", 30_250], ["-1", 30_250]] as const) {
    test(`uses exposed Retry-After ${retryAfter}`, async () => {
      const t = timing(); let calls = 0;
      await cfBytes(async () => ++calls === 1 ? rejected({ retryAfter }) : ok(), get, t.retry);
      expect(t.waits).toEqual([expected]);
    });
  }

  test("recomputes the delay for each rejection and accepts the sixth retry", async () => {
    const t = timing(); let calls = 0;
    await cfBytes(async () => ++calls <= 6 ? rejected({ retryAfter: String(calls) }) : ok("done"), get, t.retry);
    expect(calls).toBe(7); expect(t.waits).toEqual([1250, 2250, 3250, 4250, 5250, 6250]);
  });

  test("fails hard after six retries without a seventh wait", async () => {
    const t = timing(); let calls = 0;
    await expect(cfBytes(async () => { calls++; return rejected(); }, get, t.retry)).rejects.toThrow("key failed: HTTP 429 after 6 retries");
    expect(calls).toBe(7); expect(t.waits).toHaveLength(6); expect(t.logs).toHaveLength(6);
  });

  for (const status of [404, 500]) for (const colour of [false, true]) for (const fallback of [false, true]) {
    test(`${status} with 429 in its code and body fails immediately: colour=${colour}, fallback=${fallback}`, async () => {
      const t = timing(); let calls = 0;
      const message = "429 Too Many Requests\n429 Too Many Requests · HTTP /body\nRetry-After: 28";
      await expect(cfBytes(async () => { calls++; return rejected({ status, colour, fallback, message, code: 429 }); }, get, t.retry))
        .rejects.toThrow("cf get failed (1)");
      expect(calls).toBe(1); expect(t.waits).toEqual([]);
    });
  }

  test("rate-limit words without an API status box do not retry", async () => {
    const t = timing();
    await expect(cfBytes(async () => ({ code: 1, stdout: "", stderr: "429 Too Many Requests" }), get, t.retry)).rejects.toThrow("cf get failed");
    expect(t.waits).toEqual([]);
  });

  for (const appearance of ["absent", "identical", "different", "different size", "prefix children", "ambiguous", "malformed", "get fails"]) {
    test(`put checks the exact key after waiting: ${appearance}`, async () => {
      const path = mkdtempSync(join(tmpdir(), "cf-retry-")); scratch.push(path);
      const file = join(path, "body"); writeFileSync(file, "data");
      const args = ["r2", "objects", "put", "key", "--bucket-name", "fake", "--file", file];
      const t = timing(), calls: string[][] = []; let puts = 0;
      const runner: CfRunner = async (args) => {
        calls.push([...args]);
        if (args[2] === "put") return ++puts === 1 ? rejected() : ok();
        expect(t.waits).toEqual([30_250]);
        if (args[2] === "list") {
          expect(args).toEqual(["r2", "objects", "list", "--bucket-name", "fake", "--prefix", "key", "--per-page", "1000"]);
          return ok(JSON.stringify(appearance === "absent" ? [] : appearance === "malformed" ? {}
            : appearance === "ambiguous" ? Array.from({ length: 1000 }, (_, i) => ({ key: `key/${i}` }))
            : [{ key: appearance === "prefix children" ? "key/child" : "key" }]));
        }
        expect(args).toEqual(get);
        return appearance === "get fails" ? rejected({ status: 500 })
          : ok(appearance === "different" ? "DATA" : appearance === "different size" ? "data-longer" : "data");
      };
      const result = cfBytes(runner, args, t.retry);
      if (appearance.startsWith("different")) await expect(result).rejects.toThrow("Existing object differs: key");
      else if (appearance === "ambiguous") await expect(result).rejects.toThrow("Incomplete cf object listing");
      else if (appearance === "malformed") await expect(result).rejects.toThrow("Invalid cf object listing");
      else if (appearance === "get fails") await expect(result).rejects.toThrow("cf get failed");
      else await result;
      expect(puts).toBe(["absent", "prefix children"].includes(appearance) ? 2 : 1);
      expect(calls.map((args) => args[2])).toEqual(["put", "list",
        ...(["absent", "prefix children"].includes(appearance) ? ["put"] : ["ambiguous", "malformed"].includes(appearance) ? [] : ["get"])]);
      if (puts === 2) expect(calls.at(-1)).toEqual(args);
    });
  }

  test("put checks absence again before every resend and gives up after six retries", async () => {
    const path = mkdtempSync(join(tmpdir(), "cf-retry-")); scratch.push(path);
    const file = join(path, "body"); writeFileSync(file, "data");
    const t = timing(), calls: string[] = [];
    await expect(cfBytes(async (args) => { calls.push(args[2]); return args[2] === "put" ? rejected() : ok("[]"); },
      ["r2", "objects", "put", "key", "--bucket-name", "fake", "--file", file], t.retry)).rejects.toThrow("after 6 retries");
    expect(calls).toEqual(["put", ...Array.from({ length: 6 }, () => ["list", "put"]).flat()]);
  });

  test("refuses local file changes during a put wait", async () => {
    const path = mkdtempSync(join(tmpdir(), "cf-retry-")); scratch.push(path);
    const file = join(path, "body"); writeFileSync(file, "data");
    const t = timing(); let puts = 0;
    await expect(cfBytes(async (args) => {
      if (args[2] === "put") { puts++; return rejected(); }
      return ok("[]");
    }, ["r2", "objects", "put", "key", "--bucket-name", "fake", "--file", file],
    { ...t.retry, sleep: async () => { writeFileSync(file, "EDIT"); } })).rejects.toThrow("Local put bytes changed");
    expect(puts).toBe(1);
  });

  test("target identity reads use the shared retry boundary", async () => {
    const t = timing(); let calls = 0;
    const result = await resolvePublishTarget({ target: "pre", bucket: "gitstarclub-data-pre", generation: "bootstrap-retry" },
      async () => ++calls === 1 ? rejected({ http: false }) : ok('{"bucket":"gitstarclub-data-pre","deploy_env":"pre"}'), t.retry);
    expect(result.target).toBe("pre"); expect(calls).toBe(2); expect(t.waits).toEqual([30_250]);
  });

  test("bounds child calls across readers and writers and drains failures", async () => {
    let active = 0, peak = 0;
    const runner = limitCfConcurrency(async (args) => {
      active++; peak = Math.max(peak, active);
      try { await Bun.sleep(1); if (args[3] === "fail") throw new Error("failed"); return ok(); }
      finally { active--; }
    });
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => runner(
      ["r2", "objects", i % 2 ? "get" : "put", i === 2 ? "fail" : "key"], { env: { NODE_ENV: "test" } })));
    expect(peak).toBe(4); expect(active).toBe(0); expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
  });
});
