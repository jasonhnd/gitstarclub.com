import { expect, spyOn, test } from "bun:test";
import { Meta, MetadataBucketProgress, RELEASES_PATH, Releases, WorkflowValidation, type WhitelistSnapshot } from "@/lib/contracts";
import * as github from "@/lib/github";
import { installWorkflowHarness, PREVIOUS_RUN, TEST_RUN, workflowSeed, type FullJob } from "../test-support";
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
    const release = Releases.parse(h.store.json(RELEASES_PATH)).releases[0];
    const meta = Meta.parse(h.store.json(`views/${TEST_RUN}/meta.json`));
    expect(release).toMatchObject({ id: TEST_RUN, tracked_repo_count: meta.active_repo_count, skipped_repo_count: 2 });
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

for (const firstPublication of [false, true]) {
  test(`completed skips survive a failed run and resume through ${firstPublication ? "first preview" : "existing"} publication`, async () => {
    const failedRun = "refresh-2026-10-02-failed";
    const resumedRun = "refresh-2026-10-02-resumed";
    const seed = workflowSeed();
    if (firstPublication) {
      const absent = /^(canonical\/v2\/(repo-monthly|repo-weekly|repo-recent-daily|pending|site-daily|repos)\/|canonical\/v2\/meta\.json$|canonical\/v2\/whitelist\/refresh-|views\/(latest\.json$|refresh-2025))/;
      for (const path of Object.keys(seed)) if (absent.test(path)) delete seed[path];
    }
    const snapshot = JSON.parse(seed["canonical/v2/whitelist/discovery.json"]!) as WhitelistSnapshot;
    snapshot.run_id = failedRun;
    snapshot.entries.push({ id: 1025, node_id: "R_1025", owner: "example", name: "repo-1025", full_name: "example/repo-1025", stars: 99_999 });
    snapshot.count++;
    snapshot.diff.added = firstPublication ? snapshot.entries.map((row) => row.id) : [1025];
    seed[`canonical/v2/whitelist/${failedRun}.json`] = JSON.stringify(snapshot);
    seed["ops/workflows/latest-unpublished-whitelist.json"] = JSON.stringify({ run_id: failedRun, count: snapshot.count, recorded_at: snapshot.generated_at });
    const env: Record<string, string> = firstPublication ? { WORKFLOW_COLD_START: "1", PREFLIGHT_RELAX_EMPTY_SHARDS: "1" } : {};
    const metadataFor = (nodeIds: string[]) => new Map<number, github.RepoMetadata>(nodeIds.map((nodeId): [number, github.RepoMetadata] => {
      const id = Number(nodeId.slice(2));
      return [id, {
        owner: "example", owner_type: "Organization", name: `repo-${id}`, full_name: `example/repo-${id}`,
        current_stars: 10000 + id, description: null, language: "TypeScript", languages: [], topics: [],
        created_at: "2025-01-01", is_archived: false,
      }];
    }));
    const a = installWorkflowHarness(seed, env);
    let artifacts: Record<string, string>;
    spyOn(github, "fetchRepositoryMetadata").mockImplementation(async (nodeIds) => {
      if (nodeIds.some((nodeId) => Number(nodeId.slice(2)) % 32 === 26)) {
        throw new github.GitHubHttpError("graphql", 401, "injected later-bucket failure");
      }
      return metadataFor(nodeIds.filter((nodeId) => nodeId !== "R_1025" && (firstPublication || nodeId !== "R_1")));
    });
    try {
      let job = firstRefreshJob(failedRun) as FullJob | null;
      for (let hop = 0; job && hop < 100; hop++) {
        const { response, result } = await a.run(job);
        if (response.status === 500) break;
        expect(response.status).toBe(200);
        job = nextRefreshJob(job, result!) as FullJob | null;
      }
      expect(job).toMatchObject({ name: "metadata", cursor: { bucket: 26 } });
      expect(a.store.json(`ops/workflows/${failedRun}/manifest.json`)).toMatchObject({ status: "failed", published_version: null });
      expect(a.store.contents[RELEASES_PATH]).toBeUndefined();
      expect(a.store.json(`ops/workflows/${failedRun}/metadata-1.json`)).toMatchObject({
        pending_pages: [], skipped: expect.arrayContaining([{ id: 1025, node_id: "R_1025", full_name: "example/repo-1025", reason: "not_returned", value_status: "missing" }]),
      });
      expect(a.store.contents[`ops/workflows/${resumedRun}/metadata-1.json`]).toBeUndefined();
      artifacts = { ...a.store.contents };
    } finally {
      a.restore();
    }

    const b = installWorkflowHarness(artifacts!, env);
    const fetchedInB: string[] = [];
    spyOn(github, "fetchRepositoryMetadata").mockImplementation(async (nodeIds) => {
      fetchedInB.push(...nodeIds);
      return metadataFor(nodeIds);
    });
    try {
      let job = firstRefreshJob(resumedRun) as FullJob | null;
      for (let hop = 0; job && hop < 400; hop++) {
        const { response, result } = await b.run(job);
        expect(response.status, job.name).toBe(200);
        job = nextRefreshJob(job, result!) as FullJob | null;
      }
      expect(job).toBeNull();
      expect(b.store.json(`canonical/v2/whitelist/${resumedRun}.json`)).toMatchObject({ metadata_resume_run_id: failedRun });
      const borrowed = MetadataBucketProgress.parse(b.store.json(`ops/workflows/${failedRun}/metadata-1.json`));
      const current = MetadataBucketProgress.parse(b.store.json(`ops/workflows/${resumedRun}/metadata-1.json`));
      expect(current).toEqual(borrowed);
      expect(current.skipped).toHaveLength(firstPublication ? 1 : 2);
      expect(fetchedInB.some((nodeId) => Number(nodeId.slice(2)) % 32 === 1)).toBe(false);
      expect(WorkflowValidation.parse(b.store.json(`ops/workflows/${resumedRun}/validation.json`))).toMatchObject({
        ok: true, invariants: { metadata_skipped_repos: firstPublication ? 1 : 2, metadata_missing_repos: 1 },
      });
      expect(b.store.json("views/latest.json")).toMatchObject({ version: resumedRun, prev_version: firstPublication ? null : PREVIOUS_RUN });
      expect(Releases.parse(b.store.json(RELEASES_PATH)).releases).toEqual([
        expect.objectContaining({ id: resumedRun, skipped_repo_count: firstPublication ? 1 : 2 }),
      ]);
      const lookup = b.store.json<Record<string, unknown>>(`views/${resumedRun}/lookup/repos.json`);
      expect(lookup["1025"]).toBeUndefined();
      expect(b.store.contents[`views/${resumedRun}/entity/repo/1025.json`]).toBeUndefined();
      if (!firstPublication) expect(lookup["1"]).toMatchObject({ current_stars: 10_001 });
    } finally {
      b.restore();
    }
  }, 30000);
}
