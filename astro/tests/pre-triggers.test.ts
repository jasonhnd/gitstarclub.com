import { expect, test } from "bun:test";
import { astroHostWorker } from "../host-contract";
import { assertPreTriggers } from "../scripts/pre-triggers";

const preview = () => structuredClone(astroHostWorker("pre"));

test("preview deployment accepts the real contract and any trigger order", () => {
  const config = preview();
  expect(() => assertPreTriggers(config)).not.toThrow();
  config.triggers.reverse();
  expect(() => assertPreTriggers(config)).not.toThrow();
});

test("preview deployment rejects missing, extra, and duplicate schedules", () => {
  const missing = preview();
  missing.triggers.pop();
  expect(() => assertPreTriggers(missing)).toThrow();
  const extra = preview();
  extra.triggers.push({ type: "scheduled", schedule: "0 5 * * *" });
  expect(() => assertPreTriggers(extra)).toThrow();
  const duplicate = preview();
  duplicate.triggers[3] = duplicate.triggers[2];
  expect(() => assertPreTriggers(duplicate)).toThrow();
});

test("preview deployment rejects a non-preview, missing, or extra queue", () => {
  const wrong = preview();
  wrong.triggers[0] = { type: "queue", name: "gitstarclub-jobs" };
  expect(() => assertPreTriggers(wrong)).toThrow();
  const missing = preview();
  missing.triggers.shift();
  expect(() => assertPreTriggers(missing)).toThrow();
  const extra = preview();
  extra.triggers.push(extra.triggers[0]);
  expect(() => assertPreTriggers(extra)).toThrow();
});

test("preview deployment rejects route triggers and route declarations", () => {
  const config = preview();
  const route = { type: "route", pattern: "pre.example.com/*" };
  expect(() => assertPreTriggers({ ...config, triggers: [...config.triggers, route] })).toThrow();
  expect(() => assertPreTriggers({ ...config, triggers: [route, ...config.triggers.slice(1)] })).toThrow();
  expect(() => assertPreTriggers({ ...config, routes: [route] })).toThrow();
});
