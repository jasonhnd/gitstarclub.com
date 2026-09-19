---
owner: operations / workflows
status: active
last_reviewed: 2026-09-19
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
- Preview Worker (`gitstarclub-web-pre`, wrangler env `pre`) that can
  Cron/manual-start and consume one Queue message. Production Worker name
  remains `gitstarclub-web` (main only).
- Shrink fixture (`graph: "fixture"`) that writes lease + views through the P0
  storage port

Out of scope: DNS / orange-cloud, deleting production Blob, production read
primary R2, P2 ISR/Preview gates (see [CF-MIGRATION-P2.md](./CF-MIGRATION-P2.md)),
P3 full-site Workers hosting (see [CF-MIGRATION-P3.md](./CF-MIGRATION-P3.md)),
paid-plan purchases, promoting to `main`.

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

## CF Cron dispatch (code in repo; platform off)

`workers/gitstarclub-web` `scheduled` now reads `event.cron` and dispatches.
This is the cutover gate that was missing when `handleScheduled` always called
refresh start.

| `event.cron` (UTC) | Worker action | Auth |
|---|---|---|
| `0 3 * * *` | `GET {CF_CRON_ORIGIN}/api/cron/daily` | Bearer `CRON_SECRET` |
| `0 4 * * 0` or `0 4 * * 7` (or `SUN`) | `GET {CF_CRON_ORIGIN}/api/cron/weekly` | Bearer `CRON_SECRET` |
| `0 6 * * 0` or `0 6 * * 7` (or `SUN`) | existing `triggerStart` (`REFRESH_START_URL`, or `{CF_CRON_ORIGIN}/api/workflows/refresh/start`). `WORKFLOW_FIXTURE=1` still enqueues the shrink fixture **only** on these expressions | Bearer `CRON_SECRET` |
| anything else | structured `workflow.cron` log with `kind: "unknown"` and a thrown error (failed scheduled invocation) | n/a |

Sunday DoW `0` (Vercel / Unix) and `7` (Cloudflare Schedules preview mount) are
dispatch aliases, plus the unambiguous `SUN` token if a schedule uses the
documented name. Daily stays `0 3 * * *`. Accepting `7` does **not** enable
platform schedules and does **not** put expressions on production
`triggers.crons`.

`CF_CRON_ORIGIN` is a wrangler var, not a hardcoded single host:

- production (top-level): `https://gitstarclub.com`
- preview (`env.pre`): `https://pre.gitstarclub.com`

Do not point cron HTTP at the closed production `workers.dev` host. Daily and
weekly stay ordinary Next routes (not Queue jobs).

### Repo draft vs platform enable

| Surface | This change | Not this change |
|---|---|---|
| `wrangler.jsonc` top-level `triggers.crons` | stays `[]` | production schedules |
| `wrangler.jsonc` `env.pre` `triggers.crons` | three Vercel-parity expressions as a **draft** | Cloudflare `PUT .../schedules` / live `wrangler deploy` |
| `CRON_SECRET` / `REFRESH_*_URL` | documented names only | secret values in git, gist, or PR |

Writing the preview cron expressions in wrangler does **not** enable
Cloudflare Cron Triggers. Enabling schedules and injecting secrets is an
**ops runbook** after a preview Worker deploy. This document does not claim
production cron is on.

### Ops follow-up (separate execution ticket)

1. Deploy `gitstarclub-web-pre` with the dispatch build (keep production Worker off this PR).
2. Inject per-environment vars/secrets (names only here): `CRON_SECRET`, `CF_CRON_ORIGIN`, optional `REFRESH_START_URL` / `REFRESH_STEP_URL`. Preview origin must stay `https://pre.gitstarclub.com`.
3. Enable **preview** schedules only (Cloudflare schedules API for Worker `gitstarclub-web-pre`, or deploy wrangler env `pre` with the three crons). Confirm the platform schedule list matches the three strings.
4. Accept on preview: unauthenticated daily/weekly 401; Bearer daily + weekly 2xx; refresh start or fixture path 2xx; `/` and `/rankings` still 200.
5. Keep Vercel production crons running. Do **not** enable `gitstarclub-web` schedules until Jason approves a later cutover. Production `triggers.crons` must remain `[]` in this repo until that approval.

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
   remove the `pre` cron schedule). Do not delete the Queue.
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
- Worker `env.pre` (`gitstarclub-web-pre`): `0 6 * * 0` or `0 6 * * 7` with
  `WORKFLOW_FIXTURE=1` or `GET /start` with `CRON_SECRET` enqueues one fixture
  job; the Queue consumer advances one step per message. Daily/weekly crons
  HTTP to `https://pre.gitstarclub.com` and do not use the fixture queue.
- Unit tests: `web/lib/workers-host/cron-dispatch.test.ts` plus CF CI gates that
  keep production `triggers.crons` empty.
- Manual start against a Preview deployment: `GET /api/workflows/refresh/start`
  with `Authorization: Bearer <CRON_SECRET>` still returns immediately after
  enqueue.

## What this PR does not claim

- Production scheduler is still Vercel cron. Production Worker `triggers.crons`
  is still `[]`. This change does **not** enable Cloudflare schedules, inject
  secrets, stop Vercel cron, or deploy production `gitstarclub-web`.
- Apex / www DNS and Cloudflare orange-cloud are unchanged.
- The Worker `MEDIA` binding is not the production read primary (P3 may read
  Blob or R2 through the P0 port on the preview host only).
- Jason still has to approve any later cut of Sunday 06:00 from Vercel to CF.
