import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cfBytes, cfResult, limitCfConcurrency, type CfRetryOptions, type CfRunner } from "../scripts/repair-publish-cf";
import { resolvePublishTarget } from "../scripts/repair-publish-target";
import { bootstrapGenerationPrefix, buildBootstrapPhaseManifest, verifyBootstrapGeneration } from "../../pipeline/lib/bootstrap-publication.mjs";

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
  const reason = ({ 401: "Unauthorized", 403: "Forbidden", 429: "Too Many Requests", 500: "Internal Server Error" })[status] ?? "Not Found";
  const body = fallback ? `Status code: ${status}\nBody: {"message":${JSON.stringify(message)}}` : `[${code}] ${message}`;
  return `\n${paint("┌")} ${paint("APIError")}\n`
    + [body, ...(retryAfter === undefined ? [] : [`Retry-After: ${retryAfter}`]),
      `${status} ${reason}${http ? " · HTTP /accounts/fake/r2/buckets/fake/objects/key" : ""}`]
      .join("\n").split("\n").map((line) => `${paint("│")} ${paint(line)}`).join("\n")
    + `\n${paint("└")}\n` + (status === 401 ? `\n${paint("→ Try running: cf auth login")}\n` : "");
}
const rejected = (options?: Parameters<typeof boxedCfError>[0]) => ({ code: 1, stdout: "", stderr: boxedCfError(options) });
function timing() {
  const waits: number[] = [], logs: string[] = [];
  const retry: CfRetryOptions = { sleep: async (ms) => { waits.push(ms); }, random: () => 0.25,
    now: () => Date.parse("2026-10-26T12:00:00Z"), log: (line) => logs.push(line) };
  return { retry, waits, logs };
}
const get = ["r2", "objects", "get", "key", "--bucket-name", "fake"];
const whoami = ["auth", "whoami"];
const authenticated = () => ok(JSON.stringify({ authenticated: true, tokenValid: false }));
const unauthorized = (options: Parameters<typeof boxedCfError>[0] = {}) =>
  rejected({ status: 401, message: "Authentication error", ...options });

describe("shared repair cf authentication with fake runners only", () => {
  for (const operation of ["get", "list"]) for (const colour of [false, true]) for (const http of [false, true]) {
    test(`${operation} refreshes and retries the identical call: colour=${colour}, http=${http}`, async () => {
      const t = timing(), calls: string[][] = [];
      const args = operation === "get" ? get : ["r2", "objects", "list", "--prefix", "key", "--bucket-name", "fake"];
      const runner: CfRunner = async (args, child) => {
        expect(child.env.CF_DELEGATION).toBe("1");
        calls.push([...args]);
        return calls.length === 1 ? unauthorized({ colour, http }) : args[0] === "auth" ? authenticated() : ok("done");
      };
      expect(await cfBytes(runner, args, t.retry)).toEqual(Buffer.from("done"));
      expect(calls).toEqual([args, whoami, args]); expect(t.waits).toEqual([3250]);
      expect(t.logs).toEqual([
        "cf HTTP 401; refreshing authentication with cf auth whoami (shared across parallel calls)",
        "cf authentication refresh complete; waiting 3.250 seconds before retry",
        `cf ${operation} key=key HTTP 401; retry 1/1 after authentication refresh`,
      ]);
    });
  }

  test("four parallel 401s share one whoami and cooldown, including a late rejection", async () => {
    const t = timing(), cooling = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    const attempts = new Map<string, number>();
    let refreshes = 0;
    const runner = limitCfConcurrency(async (args) => {
      if (args[0] === "auth") { expect(args).toEqual(whoami); refreshes++; return authenticated(); }
      const key = args[3], attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);
      if (attempt === 1) { if (key === "3") await cooling.promise; return unauthorized(); }
      return ok(key);
    });
    const pending = Promise.all(Array.from({ length: 4 }, (_, i) => cfBytes(runner,
      ["r2", "objects", "get", String(i), "--bucket-name", "fake"], {
        ...t.retry, sleep: async (ms) => { t.waits.push(ms); cooling.resolve(); await resume.promise; },
      })));
    try {
      await cooling.promise; await Bun.sleep(1);
      expect(refreshes).toBe(1); expect([...attempts.values()]).toEqual([1, 1, 1, 1]);
      resume.resolve();
      expect((await pending).map((body) => body.toString())).toEqual(["0", "1", "2", "3"]);
      expect([...attempts.values()]).toEqual([2, 2, 2, 2]);
      expect(refreshes).toBe(1); expect(t.waits).toEqual([3250]);
    } finally { resume.resolve(); await pending; }
  });

  test("a second 401 fails hard with a safe-rerun login hint", async () => {
    const t = timing(), calls: string[][] = [];
    await expect(cfBytes(async (args) => {
      calls.push([...args]); return args[0] === "auth" ? authenticated() : unauthorized();
    }, get, t.retry)).rejects.toThrow("HTTP 401 after authentication retry. Run cf auth login and rerun the publisher (rerun is safe).");
    expect(calls).toEqual([get, whoami, get]); expect(t.waits).toEqual([3250]);
  });

  for (const throws of [false, true]) test(`failed whoami does not retry or poison later refreshes: throws=${throws}`, async () => {
    const t = timing(), calls: string[][] = [];
    const runner: CfRunner = async (args) => {
      calls.push([...args]);
      if (args[0] !== "auth") return unauthorized();
      if (throws) throw new Error("refresh runner failed");
      return unauthorized();
    };
    for (let i = 0; i < 2; i++) await expect(cfBytes(runner, get, t.retry)).rejects.toThrow(
      "authentication refresh failed. Run cf auth login and rerun the publisher (rerun is safe).");
    expect(calls).toEqual([get, whoami, get, whoami]); expect(t.waits).toEqual([]);
  });

  for (const stdout of [JSON.stringify({ authenticated: false, error: "Not logged in" }), "", "not JSON"]) {
    test(`exit-zero whoami without authenticated true fails without retry: ${JSON.stringify(stdout)}`, async () => {
      const t = timing(), calls: string[][] = [];
      await expect(cfBytes(async (args) => {
        calls.push([...args]); return args[0] === "auth" ? ok(stdout) : unauthorized();
      }, get, t.retry)).rejects.toThrow("Run cf auth login and rerun the publisher");
      expect(calls).toEqual([get, whoami]); expect(t.waits).toEqual([]);
    });
  }

  for (const colour of [false, true]) test(`401 with another API code fails immediately: colour=${colour}`, async () => {
    const t = timing(); let calls = 0;
    await expect(cfBytes(async () => { calls++; return unauthorized({ code: 10001, colour }); }, get, t.retry))
      .rejects.toThrow("cf get failed (1)");
    expect(calls).toBe(1); expect(t.waits).toEqual([]);
  });

  for (const status of [403, 404, 500]) for (const colour of [false, true]) {
    test(`${status} with 401 body lines and authentication code fails immediately: colour=${colour}`, async () => {
      const t = timing(); let calls = 0;
      await expect(cfBytes(async () => {
        calls++; return rejected({ status, colour,
          message: "Authentication error\n401 Unauthorized\n401 Unauthorized · HTTP /body\nTry running: cf auth login" });
      }, get, t.retry)).rejects.toThrow("cf get failed (1)");
      expect(calls).toBe(1); expect(t.waits).toEqual([]); expect(t.logs).toEqual([]);
    });
  }

  for (const stderr of ["[10000] Authentication error\n401 Unauthorized\nTry running: cf auth login",
    "\n┌ APIError\n│ [10000] Authentication error\n│ 401 Unauthorized\n│ 500 Internal Server Error\n└\n",
    boxedCfError({ status: 401, message: "Authentication error" }) + boxedCfError({ status: 403 })]) {
    test(`unboxed or nonauthoritative 401 fails immediately: ${JSON.stringify(stderr)}`, async () => {
      const t = timing(); let calls = 0;
      await expect(cfBytes(async () => { calls++; return { code: 1, stdout: "", stderr }; }, get, t.retry)).rejects.toThrow("cf get failed");
      expect(calls).toBe(1); expect(t.waits).toEqual([]);
    });
  }

  for (const authAt of [0, 3, 6]) test(`401 at attempt ${authAt} leaves all six 429 retries available`, async () => {
    const t = timing(), calls: string[][] = []; let reads = 0;
    await cfBytes(async (args) => {
      calls.push([...args]);
      if (args[0] === "auth") return authenticated();
      const attempt = reads++;
      return attempt === authAt ? unauthorized() : attempt < 7 ? rejected() : ok();
    }, get, t.retry);
    expect(reads).toBe(8); expect(calls.filter((args) => args[0] === "auth")).toEqual([whoami]);
    expect(t.waits.filter((ms) => ms === 30_250)).toHaveLength(6);
    expect(t.waits.filter((ms) => ms === 3250)).toHaveLength(1);
  });

  test("429s between two 401s do not allow a second authentication retry", async () => {
    const t = timing(); let reads = 0, refreshes = 0;
    await expect(cfBytes(async (args) => {
      if (args[0] === "auth") { refreshes++; return authenticated(); }
      return ++reads === 2 ? rejected() : unauthorized();
    }, get, t.retry)).rejects.toThrow("HTTP 401 after authentication retry");
    expect(reads).toBe(3); expect(refreshes).toBe(1); expect(t.waits).toEqual([3250, 30_250]);
  });

  test("a 401 refresh does not extend the six-retry 429 limit", async () => {
    const t = timing(); let reads = 0, refreshes = 0;
    await expect(cfBytes(async (args) => {
      if (args[0] === "auth") { refreshes++; return authenticated(); }
      return ++reads === 1 ? unauthorized() : rejected();
    }, get, t.retry)).rejects.toThrow("HTTP 429 after 6 retries");
    expect(reads).toBe(8); expect(refreshes).toBe(1);
    expect(t.waits).toEqual([3250, ...Array<number>(6).fill(30_250)]);
  });
});

describe("shared repair cf rate limits with fake runners only", () => {
  for (const retryFails of [false, true]) test(`verification waits for a sibling's 429 wait and consumes its result: retryFails=${retryFails}`, async () => {
    const generation = "bootstrap-429-drain", prefix = bootstrapGenerationPrefix(generation);
    const body = Buffer.from("{}"), objects = new Map<string, Buffer>();
    for (const phase of ["base", "canonical"] as const) {
      const path = phase === "base" ? "views/meta.json" : "canonical/v2/meta.json";
      objects.set(`${prefix}/${path}`, body);
      objects.set(`${prefix}/manifests/${phase}.json`, Buffer.from(JSON.stringify(
        buildBootstrapPhaseManifest(generation, phase, [{ path, body }]))));
    }
    const waiting = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    const first = new Error("base failed during sibling retry wait");
    let attempts = 0, settled = false;
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => { unhandled.push(error); };
    process.on("unhandledRejection", onUnhandled);
    const runner: CfRunner = async (args) => {
      const key = args[3];
      if (key === `${prefix}/views/meta.json`) { await waiting.promise; throw first; }
      if (key === `${prefix}/canonical/v2/meta.json`) {
        if (++attempts === 1) return rejected();
        if (retryFails) throw new Error("canonical retry failed later");
      }
      return ok(objects.get(key)!);
    };
    const verification = verifyBootstrapGeneration({ generation, concurrency: 1, store: { read: (key: string) =>
      cfBytes(runner, ["r2", "objects", "get", key, "--bucket-name", "fake"], {
        random: () => 0, log: () => {}, sleep: async (ms) => {
          expect(ms).toBe(30_000); waiting.resolve(); await resume.promise;
        },
      }) } });
    const outcome = verification.then(() => { settled = true; }, (error: unknown) => { settled = true; return error; });
    try {
      await waiting.promise; await Bun.sleep(1);
      expect(settled).toBe(false); expect(attempts).toBe(1);
      resume.resolve(); expect(await outcome).toBe(first);
      expect(attempts).toBe(2);
      await Bun.sleep(1); expect(unhandled).toEqual([]);
    } finally {
      resume.resolve(); await outcome;
      process.off("unhandledRejection", onUnhandled);
    }
  });
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

  for (const status of [429, 401]) for (const appearance of ["absent", "identical", "different", "different size", "prefix children", "ambiguous", "malformed", "get fails"]) {
    test(`put checks the exact key after ${status} waiting: ${appearance}`, async () => {
      const path = mkdtempSync(join(tmpdir(), "cf-retry-")); scratch.push(path);
      const file = join(path, "body"); writeFileSync(file, "data");
      const args = ["r2", "objects", "put", "key", "--bucket-name", "fake", "--file", file];
      const t = timing(), calls: string[][] = []; let puts = 0;
      const runner: CfRunner = async (args) => {
        calls.push([...args]);
        if (args[0] === "auth") { expect(args).toEqual(whoami); return authenticated(); }
        if (args[2] === "put") return ++puts === 1 ? (status === 401 ? unauthorized() : rejected()) : ok();
        expect(t.waits).toEqual([status === 401 ? 3250 : 30_250]);
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
      const result = cfResult(runner, args, t.retry);
      if (appearance.startsWith("different")) await expect(result).rejects.toThrow("Existing object differs: key");
      else if (appearance === "ambiguous") await expect(result).rejects.toThrow("Incomplete cf object listing");
      else if (appearance === "malformed") await expect(result).rejects.toThrow("Invalid cf object listing");
      else if (appearance === "get fails") await expect(result).rejects.toThrow("cf get failed");
      else expect((await result).alreadyPresent).toBe(appearance === "identical" ? true : undefined);
      expect(puts).toBe(["absent", "prefix children"].includes(appearance) ? 2 : 1);
      expect(calls.map((args) => args[0] === "auth" ? "whoami" : args[2])).toEqual(["put", ...(status === 401 ? ["whoami"] : []), "list",
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

  for (const status of [429, 401]) test(`refuses local file changes during a put ${status} wait`, async () => {
    const path = mkdtempSync(join(tmpdir(), "cf-retry-")); scratch.push(path);
    const file = join(path, "body"); writeFileSync(file, "data");
    const t = timing(); let puts = 0;
    await expect(cfBytes(async (args) => {
      if (args[0] === "auth") return authenticated();
      if (args[2] === "put") { puts++; return status === 401 ? unauthorized() : rejected(); }
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
