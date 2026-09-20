---
owner: operations / workflows
status: active
last_reviewed: 2026-09-20
source_of_truth_for:
  - Cloudflare migrate P1 workflow runtime
  - non-production CF Cron / Queue orchestration
  - CF Workers Blob fetch write path for full cron / refresh lease
  - CF refresh preflight 1102 budget (batched shard windows)
  - CF refresh lease renew / fencing-token CAS (CDN ETag + Queue overlap)
  - CF refresh fold→recompute stall (Queue consumer successor / public /enqueue hop)
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

## CF Workers Blob write path (full cron / refresh)

Preview dry cron (`daily?dry=1` / `weekly?dry=1`) can return 200 without
writing. Full daily and `GET /api/workflows/refresh/start` must claim a Blob
lease (`ops/workflows/active.json` or `live/latest.json`) and write
generations. On `HOSTING_TARGET=cf`, the `@vercel/blob` SDK's undici/Node TLS
transport throws `options.ALPNProtocols option is not implemented` and those
routes 500 / stall.

The default Blob driver now uses `web/lib/storage/vercel-blob-fetch-client.ts`:
runtime `fetch` to `https://vercel.com/api/blob` with the same CAS headers as
the official SDK (`x-allow-overwrite`, `x-if-match`, `x-api-version`). That is
the Workers-safe path. Optional alternative: `STORAGE_WRITE_DRIVER=r2` already
signs S3 with `fetch` (`web/lib/storage/r2-s3-store.ts`) under a non-production
`migrate-*` prefix. Default CF preview stays on Vercel Blob so lease/views
remain on the public store `BLOB_BASE_URL` already serves.

**Full CF daily / refresh depends on this fetch write path.** This change does
not enable Cloudflare schedules. Production `wrangler.jsonc` `triggers.crons`
must remain `[]` until a later approved cutover. Vercel cron stays the
production scheduler.

## CF refresh preflight budget (1102)

Preview evidence (cf-queue already on): Bearer `refresh/start` is 200, Queue
consumes `startRun`, and `POST /enqueue` of `preflight` is 200 queued — but a
direct `POST /api/workflows/refresh/step` with `name=preflight` returned
**503 Cloudflare 1102** at ~13.6s. Error 1102 is a Worker resource/CPU/memory
kill, not auth or ALPN.

The hotspot was `validateCanonicalGeneration` inside workflow preflight: one
invocation `Promise.all`'d all **128** required canonical shards (4 families ×
32 buckets), parsed each with Zod, and SHA-256'd the stable JSON. On OpenNext
each Blob GET can also take an ASSETS cache subrequest, so the isolate ran out
of budget before any checkpoint after `startRun`.

Workflow preflight now stays on **cf-queue** (do not roll back to HTTP as the
preview primary) and splits the same 128-shard gate:

| Knob | Value |
|---|---|
| Bucket window | 4 buckets / invocation (16 shards) |
| Read concurrency | 4 on Vercel; **2** on `HOSTING_TARGET=cf` |
| SHA-256 receipts | deferred to step `validate` |
| Family emptiness | counted across windows; checked on the last batch |
| Checkpoints | `preflight-0` … `preflight-28` |

Route start preflight is unchanged (meta + 32 `repos` shards only). Production
`triggers.crons` stays `[]`. Vercel cron is not stopped.

### Suggested CF preflight retest (preview Worker only)

1. Keep `WORKFLOW_RUNTIME=cf-queue` and
   `WORKFLOW_QUEUE_ENQUEUE_URL=https://pre.gitstarclub.com/enqueue`. Do **not**
   PUT production schedules and do **not** stop Vercel cron.
2. Wait for any active lease to expire, or use a new idempotency key.
3. Bearer `GET https://pre.gitstarclub.com/api/workflows/refresh/start` → **200**
   `started` with a `run_id`.
4. Workers Observability: `queue` consume for `startRun`, then `preflight`
   (repeated windows). No 1102 on the step origin.
5. Direct Bearer `POST /api/workflows/refresh/step` with a `preflight` job for
   one window (`cursor.preflightOffset` 0, 4, …) → **not** 503/1102 (2xx, or
   a JSON 4xx/5xx from the app — not Cloudflare 1102).
6. Blob within a few minutes: `ops/workflows/<run_id>/steps/preflight-0.json`
   (and later `preflight-4.json` …) plus a subsequent step such as
   `whitelist.json` or `rename.json`. Stuck-only-`startRun` is the old 1102
   failure mode.
7. Confirm production Worker `triggers.crons` is still `[]`.

## CF refresh lease renew (fencing token)

Preview evidence after #473 (CRON-PRE-RETEST-004): Bearer start 200, all eight
`preflight-*` checkpoints ok, Queue origin live — then the run wrote
`error.json` with `lost ownership while renewing fencing token 21` (~3 min
after `preflight-28`) and never produced whitelist. That string was **CAS
exhaustion** (`compareAndSet` 412 × 3, no backoff), not a successor
`fencing_token`. `markFailed` could still renew (same run still owned) and
release the lease as failed.

Root cause (all three together):

1. **Public CDN GET used as the ifMatch ETag.** `BlobWorkflowLeaseStore.read()`
   went through the public Blob URL (`cacheControlMaxAge: 60`). Same class of
   bug as weekly live pointer #402: origin `head()` is the fence, public GET
   is path-cached (`?v=` does not bust). Three instant retries replay the same
   stale ETag.
2. **Same-owner overlap on cf-queue.** Queue consumer `fetch(REFRESH_STEP_URL)`
   hops `https://pre.gitstarclub.com` (Cloudflare proxy 524 at ~100–125s).
   Whitelist GitHub Search runs longer. The consumer throws, `max_retries: 2`
   redelivers, and the first isolate may still be in Search. Two renews hit
   one generation; the loser used to fail closed and `markFailed` poisoned
   the winner.
3. **Read-your-writes cache is isolate-local (2 min).** After preflight
   batching, whitelist is a new isolate and Search exceeds that window.

Fix (keeps `WORKFLOW_RUNTIME=cf-queue`; does not roll back to HTTP):

- Lease read: Blob API `head()` etag; withhold CAS when CDN GET and origin
  etag diverge; `cache: "no-store"` + `cf.cacheTtl=0` on public GET.
- Lease writes: `max-age=0`.
- Renew: 5 CAS attempts, health-style backoff, coalesce onto a peer
  same-owner renew, throw retryable `WorkflowLeaseCasError` instead of
  ownership loss while we still own the token.
- Whitelist: prove the fence **before** Search and again before the snapshot.
- Queue consumer: `WORKER_SELF_REFERENCE.fetch` so the step hop does not
  take the public 524 path.

Production `triggers.crons` stays `[]`. Do not stop Vercel cron. Do not cut DNS.

### Suggested CF lease-renew retest (preview Worker only)

1. Keep `WORKFLOW_RUNTIME=cf-queue` and
   `WORKFLOW_QUEUE_ENQUEUE_URL=https://pre.gitstarclub.com/enqueue`. Do **not**
   PUT production schedules and do **not** stop Vercel cron.
2. Wait for any active lease to expire, or use a new idempotency key.
3. Bearer `GET https://pre.gitstarclub.com/api/workflows/refresh/start` → **200**
   `started` with a `run_id`.
4. Workers Observability: `queue` consume for `startRun`, then `preflight`
   windows, then `whitelist`. Step log should show `via: "self-reference"`.
   No `lost ownership while renewing fencing token`. No Cloudflare 524 on
   the public step hop.
5. Blob within a few minutes: `ops/workflows/<run_id>/steps/preflight-0.json`
   … `preflight-28.json` (ok), then `steps/whitelist.json` (ok) or a later
   step. `active.json` must not flip to `failed` with a renew-ownership error
   while `fencing_token` is still this run.
6. If whitelist is still running (GitHub Search), `active.json` stays
   `status=running` for the same `run_id` / token. A Queue retry of
   `whitelist` must not release that lease.
7. Confirm production Worker `triggers.crons` is still `[]`.

## CF refresh fold → recompute (Queue successor)

Preview evidence after #475 (CRON-PRE-PR475-RUN-FINAL-001): Bearer start
200, preflight windows → whitelist → rename → metadata-0..31 → **`fold` ok**
@ 09:59:07Z. Then **recompute never started**: Observability `queue` origin
silent after fold, lease `expires_at` lapsed with `status=running`, no
`error.json`, no `recomputeRank` / `aliases` / `validate` / `publish` / `gc`.

Root cause (all three together):

1. **Successor enqueue lived in the fold isolate.** After writing
   `steps/fold.json`, `completeStep` POSTed `WORKFLOW_QUEUE_ENQUEUE_URL`
   (`https://pre.gitstarclub.com/enqueue`) with global `fetch`. That is the
   same public hop #475 removed from consumer→step. Fold is the first step
   that already spent the isolate on 32 monthly + 32 weekly shards. The extra
   hop never became a consumed Queue message.
2. **The Queue consumer only checked `response.ok`.** `await binding.fetch()`
   resolves when headers exist, not when the JSON body exists. Cloudflare
   **terminates a service-bound child when the parent stops awaiting**. After
   fold the consumer acked and returned; the child died before `/enqueue`
   landed. No `error.json` because `failRefreshJob` never ran.
3. **`max_retries: 2` plus a silent ack.** Once fold looked successful, the
   queue went quiet. The lease stopped renewing until it expired.

Fix (keeps `WORKFLOW_RUNTIME=cf-queue`; does not roll back to HTTP):

- Queue consumer reads the step JSON body (keeps the child alive), then
  `JOBS.send(nextRefreshJob)` — Queue binding, not the public `/enqueue` hop.
- Consumer sets `x-gitstarclub-queue-advance: consumer`. On `cf-queue` the
  step isolate skips `completeStep`. Direct POST `/step` still enqueues.
- `loadCanonicalModel` uses the same CF shard-read cap as preflight
  (`mapLimit` 2, sequential families) so `recomputeRank` does not immediately
  1102 on the old 128-way fan-out.

Production `triggers.crons` stays `[]`. Do not stop Vercel cron. Do not cut DNS.

### Suggested CF fold→recompute retest (preview Worker only)

1. Keep `WORKFLOW_RUNTIME=cf-queue` and
   `WORKFLOW_QUEUE_ENQUEUE_URL=https://pre.gitstarclub.com/enqueue`. Do **not**
   PUT production schedules and do **not** stop Vercel cron.
2. Wait for any active lease to expire, or use a new idempotency key
   (`?idempotency_key=` / `Idempotency-Key`).
3. Bearer `GET https://pre.gitstarclub.com/api/workflows/refresh/start` → **200**
   `started` with a `run_id`.
4. Workers Observability: `queue` consume continues **after** `fold`. Step log
   `workflow.advance` should show `fold` → `recomputeRank` (then
   `recomputeRepoEntities` → `recomputeOrgEntities` → `recomputeHeatmap` →
   `aliases` → `validate` → `publish` → `gc` → `markPublished`). No silent
   gap after `fold.json`.
5. Blob: `ops/workflows/<run_id>/steps/fold.json` (ok) then
   `steps/recomputeRank.json` (and later `aliases.json`, `validate.json`,
   `publish.json`; `gc.json` if that step ran). Checkpoint names are the
   runtime step names, not the 10-name manifest aliases `recompute` /
   `buildAliases`.
6. `active.json` should reach `published` (or at least stay `running` with a
   renewing `expires_at` while recompute writes). A fold-then-silence stall
   with expired lease and no `error.json` is the old failure mode.
7. Confirm production Worker `triggers.crons` is still `[]`.

### Suggested CF retest (preview Worker only)

1. Redeploy `gitstarclub-web-pre` with this build. Do **not** PUT production
   schedules and do **not** stop Vercel cron.
2. No Bearer → `/api/cron/daily` and `/api/workflows/refresh/start` → 401.
3. Bearer `GET /api/cron/daily?dry=1` and `/api/cron/weekly?dry=1` → 200.
4. Bearer `GET /api/workflows/refresh/start` → **2xx** (acquired / attached /
   rejected). Must not 500 with `ALPNProtocols` or `fetch failed`.
5. Bearer full `GET /api/cron/daily` may run long; it must not fail immediately
   with the TLS/ALPN error (timeout from work length is a separate limit).
6. Workers Observability: no `options.ALPNProtocols option is not implemented`.
7. Confirm production Worker `triggers.crons` is still `[]`.

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
