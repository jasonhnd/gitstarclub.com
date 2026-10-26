import { expect, test } from "bun:test";
import { Meta, NonNegativeInt, RELEASES_PATH, Releases, ViewsPointer } from "../../src/lib/contracts";
import { runRefreshStepRoute } from "../../src/packages/p7/operations";
import { installWorkflowHarness, TEST_RUN, workflowSeed, type FullJob } from "../../../web/lib/workflows/test-support";
import { nextRefreshJob } from "../../../web/lib/workflows/runtime/graph";
import { firstRefreshJob } from "../../../web/lib/workflows/runtime/types";

test("Astro's shared refresh publishes the public release contract and retry preserves it", async () => {
  const h = installWorkflowHarness(workflowSeed());
  try {
    let job = firstRefreshJob(TEST_RUN) as FullJob | null;
    let publish: FullJob | undefined;
    for (let hop = 0; job && hop < 400; hop++) {
      if (job.name === "publish" && !publish) publish = structuredClone(job);
      const { response, result } = await h.run(job, { route: runRefreshStepRoute });
      expect(response.status, job.name).toBe(200);
      job = nextRefreshJob(job, result!) as FullJob | null;
      // Retain the running lease to replay publication before cleanup releases it.
      if (job?.name === "gc") break;
    }
    expect(job?.name).toBe("gc");
    const pointer = ViewsPointer.parse(h.store.json("views/latest.json"));
    const meta = Meta.parse(h.store.json(`views/${TEST_RUN}/meta.json`));
    const bytes = h.store.contents[RELEASES_PATH];
    expect(Releases.parse(JSON.parse(bytes)).releases).toEqual([{
      id: TEST_RUN, published_at: pointer.published_at, prev_version: pointer.prev_version,
      tracked_repo_count: NonNegativeInt.parse(meta.active_repo_count), skipped_repo_count: 0,
      data_as_of: { seam_date: meta.seam_date, generated_at: meta.generated_at, folded_through: meta.folded_through },
    }]);
    expect((await h.run(publish!, { route: runRefreshStepRoute })).response.status).toBe(200);
    expect(h.store.contents[RELEASES_PATH]).toBe(bytes);
  } finally { h.restore(); }
}, 30000);
