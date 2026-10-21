import { expect, spyOn, test } from "bun:test";
import { WorkflowValidation, type WhitelistSnapshot } from "@/lib/contracts";
import * as github from "@/lib/github";
import { installWorkflowHarness, TEST_RUN, workflowSeed, type FullJob } from "../test-support";
import { nextRefreshJob } from "./graph";
import { firstRefreshJob } from "./types";

test("the real refresh publishes retained values and an audited missing newcomer without zero rows", async () => {
  const seed = workflowSeed();
  const discoveryPath = "canonical/v2/whitelist/discovery.json";
  const discovery = JSON.parse(seed[discoveryPath]!) as WhitelistSnapshot;
  discovery.entries.push({ id: 1001, node_id: "R_1001", owner: "example", name: "repo-1001", full_name: "example/repo-1001", stars: 99_999 });
  discovery.count++;
  seed[discoveryPath] = JSON.stringify(discovery);
  seed["ops/workflows/latest-unpublished-whitelist.json"] = JSON.stringify({ run_id: "discovery", count: discovery.count, recorded_at: discovery.generated_at });
  const h = installWorkflowHarness(seed);
  spyOn(github, "fetchRepositoryMetadata").mockImplementation(async (nodeIds) => new Map(nodeIds.flatMap((nodeId) => {
    const id = Number(nodeId.slice(2));
    if (id === 1 || id === 1001) return [];
    return [[id, {
      owner: "example", owner_type: "Organization" as const, name: `repo-${id}`, full_name: `example/repo-${id}`,
      current_stars: 10000 + id, description: null, language: "TypeScript", languages: [], topics: [],
      created_at: "2025-01-01", is_archived: false,
    }]];
  })));
  try {
    let job = firstRefreshJob(TEST_RUN) as FullJob | null;
    for (let hop = 0; job && hop < 400; hop++) {
      const { response, result } = await h.run(job);
      expect(response.status, job.name).toBe(200);
      job = nextRefreshJob(job, result!) as FullJob | null;
    }
    expect(job).toBeNull();
    expect(h.store.json("views/latest.json")).toMatchObject({ version: TEST_RUN });
    const validation = WorkflowValidation.parse(h.store.json(`ops/workflows/${TEST_RUN}/validation.json`));
    expect(validation).toMatchObject({ ok: true, invariants: { metadata_skipped_repos: 2, metadata_missing_repos: 1 } });
    expect(h.store.json(`ops/workflows/${TEST_RUN}/metadata-1.json`)).toMatchObject({ skipped: [{ id: 1, full_name: "example/repo-1", value_status: "retained" }] });
    expect(h.store.json(`ops/workflows/${TEST_RUN}/metadata-9.json`)).toMatchObject({ skipped: [{ id: 1001, full_name: "example/repo-1001", value_status: "missing" }] });
    const lookup = h.store.json<Record<string, unknown>>(`views/${TEST_RUN}/lookup/repos.json`);
    expect(lookup["1"]).toMatchObject({ current_stars: 10_001 });
    expect(lookup["1001"]).toBeUndefined();
    expect(h.store.json(`views/${TEST_RUN}/entity/repo/1.json`)).toMatchObject({ current_stars: 10_001 });
    expect(h.store.contents[`views/${TEST_RUN}/entity/repo/1001.json`]).toBeUndefined();
    for (const [path, body] of Object.entries(h.store.contents)) {
      if (!path.startsWith(`views/${TEST_RUN}/rank/`)) continue;
      const rank = JSON.parse(body) as { items: { id?: number; rank: number }[] };
      expect(rank.items.some((row) => row.id === 1001)).toBe(false);
      expect(rank.items.every((row) => row.rank > 0)).toBe(true);
    }
  } finally {
    h.restore();
  }
}, 30000);
