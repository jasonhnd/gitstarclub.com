import { describe, expect, test } from "bun:test";
import {
  parseListedBootstrapGenerations,
  selectBootstrapGenerationToCommit,
} from "./ensure-bootstrap-pointer";

const pointer = {
  schema_ver: 1,
  generation: "bootstrap-20260717T120000Z",
  prefix: "bootstrap/generations/bootstrap-20260717T120000Z",
  previous_generation: null,
  published_at: "2026-07-17T12:00:00.000Z",
  base_manifest_sha256: "a".repeat(64),
  canonical_manifest_sha256: "b".repeat(64),
};

describe("ensure bootstrap pointer plan", () => {
  test("is a no-op when a valid pointer already exists", () => {
    expect(
      selectBootstrapGenerationToCommit(pointer, [
        { generation: "bootstrap-older", prefix: "bootstrap/generations/bootstrap-older" },
      ]),
    ).toEqual({ action: "already-present", pointer });
  });

  test("refuses to invent a pointer when no sealed generation exists", () => {
    const plan = selectBootstrapGenerationToCommit(null, []);
    expect(plan.action).toBe("leave-legacy-flat");
  });

  test("selects the newest listed sealed generation for an idempotent commit", () => {
    const plan = selectBootstrapGenerationToCommit(null, [
      { generation: "bootstrap-20260701T000000Z", prefix: "bootstrap/generations/bootstrap-20260701T000000Z" },
      { generation: "bootstrap-20260719T060000Z", prefix: "bootstrap/generations/bootstrap-20260719T060000Z" },
    ]);
    expect(plan).toMatchObject({
      action: "commit",
      generation: "bootstrap-20260719T060000Z",
    });
  });

  test("parses folded Blob prefixes into generation ids", () => {
    expect(
      parseListedBootstrapGenerations([
        "bootstrap/generations/bootstrap-20260719T060000Z/",
        "bootstrap/overlays/bootstrap-20260719T060000Z/",
        "views/refresh-1/",
      ]),
    ).toEqual([
      {
        generation: "bootstrap-20260719T060000Z",
        prefix: "bootstrap/generations/bootstrap-20260719T060000Z",
      },
    ]);
  });
});
