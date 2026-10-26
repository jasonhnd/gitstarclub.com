import { fixtureRecords } from "../scripts/fixture";
import { Releases } from "../src/lib/contracts";

export const RELEASE_ID = "refresh-2026-10-25T04-00-00-000Z";
export const PREVIOUS_ID = "refresh-2026-10-18T04-00-00-000Z";
export function releaseRecords() {
  const records = fixtureRecords(RELEASE_ID, "2026-10-25T05:12:00.000Z");
  records.set("views/releases.json", JSON.stringify(Releases.parse({ schema_ver: 1, releases: [{
    id: RELEASE_ID, published_at: "2026-10-25T05:12:00.000Z", prev_version: PREVIOUS_ID,
    tracked_repo_count: 12345, skipped_repo_count: 7,
    data_as_of: { seam_date: "2026-07-01", generated_at: "2026-10-25T04:58:00.000Z", backfilled_at: "2026-07-02T00:00:00.000Z", folded_through: { month: "2026-09", week: "2026-W42" } },
  }, {
    id: PREVIOUS_ID, published_at: "2026-10-18T05:12:00.000Z", prev_version: null,
    tracked_repo_count: 12000, skipped_repo_count: 0, data_as_of: { seam_date: "2026-07-01" },
  }] })));
  records.set("ops/workflows/latest-success.json", JSON.stringify({ run_id: RELEASE_ID, version: RELEASE_ID, published_at: "2026-10-25T05:12:00.000Z" }));
  records.set("ops/workflows/health/workflow-refresh.json", JSON.stringify({
    schema_version: 2, pipeline: "workflow-refresh", status: "ok", at: "2026-10-25T05:12:00.000Z", correlation_id: RELEASE_ID,
    run_id: RELEASE_ID, idempotency_key: null, error: null, last_success: null, last_failure: null,
    freshness: { last_success_at: "2026-10-25T05:12:00.000Z", expected_within_seconds: 691200, stale_after: "2026-11-02T05:12:00.000Z" },
  }));
  return records;
}
