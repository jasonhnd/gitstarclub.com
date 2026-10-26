import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { listCfPrefix, matchesListedObject, type CfRunner } from "../scripts/repair-publish-cf";

const prefix = "bootstrap/generations/bootstrap-list-test/";
const md5 = (body: Buffer) => createHash("md5").update(body).digest("hex");
const row = (key: string, body = Buffer.from("a")) => ({ key, size: body.length, etag: md5(body) });

test("walks 1000-row pages with the last key and stops only on a short page", async () => {
  const records = Array.from({ length: 2000 }, (_, index) => row(`${prefix}${String(index).padStart(5, "0")}.json`));
  const calls: string[][] = [];
  const runner: CfRunner = async (args) => {
    calls.push(args);
    const after = args.includes("--start-after") ? args[args.indexOf("--start-after") + 1] : "";
    return { code: 0, stdout: JSON.stringify(records.filter(({ key }) => key > after).slice(0, 1000)), stderr: "" };
  };
  const result = await listCfPrefix(runner, prefix, "fake-bucket");
  expect(result.size).toBe(2000);
  expect(calls).toHaveLength(3);
  expect(calls.map((args) => args.includes("--start-after") ? args[args.indexOf("--start-after") + 1] : null))
    .toEqual([null, records[999].key, records[1999].key]);
  expect(calls.every((args) => args[args.indexOf("--per-page") + 1] === "1000")).toBe(true);
});

test("accepts only matching size and bare or quoted MD5 etags", () => {
  const body = Buffer.from("same bytes");
  expect(matchesListedObject(row(`${prefix}a`, body), body)).toBe(true);
  expect(matchesListedObject({ ...row(`${prefix}a`, body), etag: `"${md5(body)}"` }, body)).toBe(true);
  expect(matchesListedObject({ ...row(`${prefix}a`, body), size: body.length + 1 }, body)).toBe(false);
  expect(matchesListedObject({ ...row(`${prefix}a`, body), etag: md5(Buffer.from("different")) }, body)).toBe(false);
});

test("source listings may carry a non-MD5 etag, but it cannot verify a generation object", async () => {
  const record = { key: `${prefix}a`, size: 1, etag: '"multipart-2"' };
  const runner: CfRunner = async () => ({ code: 0, stdout: JSON.stringify([record]), stderr: "" });
  expect((await listCfPrefix(runner, prefix, "fake-bucket")).get(record.key)).toEqual(record);
  expect(matchesListedObject(record, Buffer.from("a"))).toBe(false);
});

for (const [name, records] of Object.entries({
  reversed: [row(`${prefix}b`), row(`${prefix}a`)],
  duplicate: [row(`${prefix}a`), row(`${prefix}a`)],
  outside: [row("outside/a")],
  size: [{ ...row(`${prefix}a`), size: -1 }],
  etag: [{ ...row(`${prefix}a`), etag: "" }],
  oversized: Array.from({ length: 1001 }, (_, index) => row(`${prefix}${String(index).padStart(5, "0")}`)),
})) test(`refuses ${name} listing anomaly`, async () => {
  const runner: CfRunner = async () => ({ code: 0, stdout: JSON.stringify(records), stderr: "" });
  await expect(listCfPrefix(runner, prefix, "fake-bucket")).rejects.toThrow("Invalid cf object listing");
});

test("refuses a full page repeated after start-after", async () => {
  const records = Array.from({ length: 1000 }, (_, index) => row(`${prefix}${String(index).padStart(5, "0")}`));
  const runner: CfRunner = async () => ({ code: 0, stdout: JSON.stringify(records), stderr: "" });
  await expect(listCfPrefix(runner, prefix, "fake-bucket")).rejects.toThrow("Invalid cf object listing");
});
