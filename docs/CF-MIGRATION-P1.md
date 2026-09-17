---
owner: operations / workflows
status: active
last_reviewed: 2026-09-17
source_of_truth_for:
  - Cloudflare migrate P1 workflow runtime
  - non-production CF Cron / Queue orchestration
  - dual-scheduler rollback (CF Cron off, production stays Vercel)
---

# Cloudflare migrate P1 (workflow / cron)

> Cloudflare migrate **P1** only: drop the Vercel Workflow SDK hard dependency
> from managed refresh, and prove a Queue-schedulable step chain. This does
> **not** cut DNS, does **not** orange-cloud apex/www, does **not** change the
> production `web/vercel.json` cron table, and does **not** make R2 the
> production read primary.

## Scope

This document owns the P1 orchestration change added in
`web/lib/workflows/runtime/` and `workers/gitstarclub-web/`:

- Runtime port: `startRefresh` / `enqueueStep` / `completeStep`
- In-memory implementation for tests
- HTTP self-chain for the existing Vercel start route
- Optional CF Queues adapter (`WORKFLOW_RUNTIME=cf-queue`)
- Non-production Worker (`gitstarclub-web`) that can Cron/manual-start and
  consume one Queue message
- Shrink fixture (`graph: "fixture"`) that writes lease + views through the P0
  storage port

Out of scope: DNS / orange-cloud, deleting production Blob, production read
primary R2, P2 ISR/Preview gates (see [CF-MIGRATION-P2.md](./CF-MIGRATION-P2.md)),
P3 full-site Workers hosting, paid-plan purchases, promoting to `main`.

Prepared Cloudflare resources (documentation only; production scheduling is
still Vercel):

- account_id: `00f850e853e4c7f9627233d51a6e30a1`
- Queue: `gitstarclub-jobs` (`a9090a06beb148979057b057b6d0573e`)
- Worker shell: `gitstarclub-web` with binding `JOBS` → that queue; `MEDIA` →
  `gitstarclub-assets` (R2 writes stay on the P0 non-production prefix guard)

## Production source of truth

Production weekly refresh is still scheduled by Vercel:

```jsonc
// web/vercel.json — unchanged in P1
{
  "crons": [
    { "path": "/api/cron/daily", "schedule": "0 3 * * *" },
    { "path": "/api/cron/weekly", "schedule": "0 4 * * 0" },
    { "path": "/api/workflows/refresh/start", "schedule": "0 6 * * 0" }
  ]
}
```

`GET /api/cron/daily` and `GET /api/cron/weekly` stay callable with the same
`CRON_SECRET`. P1 does not replace those jobs.

The Sunday 06:00 start route no longer imports `workflow/api` or `"use workflow"`
/ `"use step"`. It acquires the existing lease, then `startRefresh`s through the
runtime. Default `WORKFLOW_RUNTIME=http` POSTs one step at a time to
`/api/workflows/refresh/step`.

Do not disable Fluid Compute as a bet on the new chain. Do not enable the
Worker production cron until Jason approves a cutover.

## Runtime kinds

| `WORKFLOW_RUNTIME` | Where | Behavior |
|---|---|---|
| `http` (default) | Vercel Production / Preview | `after()` + POST `/api/workflows/refresh/step` |
| `memory` | tests | In-process queue + `drain()` |
| `cf-queue` | non-production only | POST `WORKFLOW_QUEUE_ENQUEUE_URL` (Worker `/enqueue`) |

Lease and view writes still go through `web/lib/storage` (P0). Unset drivers
mean Vercel Blob, which is enough to accept the orchestration.

## Dual-scheduler rollback

If a non-production CF Cron or Queue consumer is enabled and misbehaves:

1. Disable the Worker cron (empty `triggers.crons` on `gitstarclub-web`, or
   remove the `nonprod` cron schedule). Do not delete the Queue.
2. Leave `web/vercel.json` as the production schedule. Sunday 06:00 still hits
   `/api/workflows/refresh/start` on Vercel.
3. Set `WORKFLOW_RUNTIME=http` (or unset it) on the Next deployment so start
   no longer POSTs to the Worker.
4. Production read/write stays on Vercel Blob unless P0 driver switches are
   also rolled back; see [R2-MIGRATION-P0.md](./R2-MIGRATION-P0.md).
5. Do not cut DNS. Do not empty Blob.

After that, production scheduling is Vercel-only again. The CF Worker can stay
deployed as a shell.

## Non-production proof

- Tests: `web/lib/workflows/runtime/*.test.ts` drain a shrink fixture through
  `MemoryObjectStore` + `BlobWorkflowLeaseStore`. Lease CAS still wins/loses
  on ETag. No `workflow` package is required.
- Worker `env.nonprod`: CF Cron or `GET /start` with `CRON_SECRET` enqueues
  one fixture job; the Queue consumer advances one step per message.
- Manual start against a Preview deployment: `GET /api/workflows/refresh/start`
  with `Authorization: Bearer <CRON_SECRET>` still returns immediately after
  enqueue.

## What this PR does not claim

- Production scheduler is still Vercel cron.
- Apex / www DNS and Cloudflare orange-cloud are unchanged.
- The Worker `MEDIA` binding is not the production read primary.
- Jason still has to approve any later cut of Sunday 06:00 from Vercel to CF.
