import assert from "node:assert/strict";
import { PREVIEW_CRON_TRIGGERS } from "../../scripts/cf-ci-gates.mjs";

type Trigger = { type: string; name?: string; schedule?: string };

/** Validate preview triggers without running the owner-only deployment script. */
export function assertPreTriggers(config: { triggers: Trigger[]; routes?: unknown }) {
  assert(!config.routes, "preview must not declare routes");
  assert.equal(config.triggers.length, 1 + PREVIEW_CRON_TRIGGERS.length, "exact preview trigger count");
  const queues = config.triggers.filter((trigger) => trigger.type === "queue");
  assert.equal(queues.length, 1, "exactly one preview queue required");
  assert.equal(queues[0].name, "gitstarclub-jobs-pre", "preview queue required");
  const schedules = config.triggers.filter((trigger) => trigger.type === "scheduled").map((trigger) => trigger.schedule);
  assert.deepEqual(schedules.sort(), [...PREVIEW_CRON_TRIGGERS].sort(), "exact preview schedules required");
}
