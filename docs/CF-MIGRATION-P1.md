---
owner: operations / workflows
status: active
last_reviewed: 2026-09-21
source_of_truth_for:
  - Cloudflare migrate P1 workflow runtime
  - non-production CF Cron / Queue orchestration
  - CF Workers Blob fetch write path for full cron / refresh lease
  - CF refresh preflight 1102 budget (batched shard windows)
  - CF refresh lease renew / fencing-token CAS (CDN ETag + Queue overlap)
  - CF refresh lease origin-body renew after #499 week hops (ETag consistency)
  - CF refresh fold→recompute stall (Queue consumer successor / public /enqueue hop)
  - CF refresh fold Worker memory limit (windowed fold + successor header)
  - CF refresh fold still OOM after fold-month-0 (1-bucket + month/week plan hops)
  - CF refresh plan hop skip + recompute OOM after #484 (fold-decision + rank family hops)
  - CF refresh recompute still OOM after #486 (packed window + finer rank hops)
  - CF refresh week-start OOM after #497 (streamed week period hops)
  - CF preview page 500: H1 same-isolate OOM vs H2 liveHistory (#496)
  - CF preview Bearer full-refresh acceptance matrix (fold-decision / recompute hops / silence-is-fail)
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

## CF refresh lease origin-body renew after #499 week hops

Preview evidence after #499 (CRON-PRE-PR499-RETEST-001): Bearer start 200,
OOM×0, fold `no_closed_month`, packed month/year hops, week-pack, streamed
`recomputeRank-week-{0,8,16,24,32}` and `week-repo-carry` all `ok`. Queue
stayed live. Then `error.json` at 03:35:02Z:

`could not read a consistent origin ETag while renewing fencing token 28`

`active.json` → `failed` (same `run_id`, token 28). No terminal week /
weekOrg / rest / `recomputeRank` / `publish` / `gc`.

Root cause relative to #475 / #499:

1. **#475 withheld CAS when public GET and origin `head()` diverged.** That
   stops stale CDN body + origin etag from overwriting a successor. Correct
   safety. It is not a consistent `(body, etag)` pair.
2. **#499 week hops are new queue isolates.** The 2 min read-your-writes
   cache is isolate-local. After `week-32` / `week-repo-carry` the next hop
   has an empty cache. Public GET stays on the previous lease generation for
   the Blob CDN window (`?v=` does not bust).
3. **Five short CAS retries (~seconds) still see `etag: null`.**
   `WorkflowLeaseCasError` is retryable, but step retry (250 ms / 1 s) is
   still inside that window. `markFailed` later renewed (same token still
   owned) and released `failed`.

Fix (keeps `WORKFLOW_RUNTIME=cf-queue` and the #499 week stream; does not
roll back to HTTP):

- Lease read prefers `ObjectStore.getOrigin()` — one private Blob GET
  (`{storeId}.private.blob.vercel-storage.com` + `cache=0`) so body and etag
  come from the same origin response.
- Public GET + `head()` remains the fallback when `getOrigin` is absent
  (memory / R2) or throws. Divergent CDN/origin pairs still withhold etag.
- A successor on origin still fails closed (ownership loss). Same-owner
  overlap still coalesces / throws retryable `WorkflowLeaseCasError`.

Production `triggers.crons` stays `[]`. Do not stop Vercel cron. Do not cut DNS.

### Suggested CF origin-ETag renew retest (preview Worker only)

Score the [acceptance matrix](#preview-bearer-full-refresh-acceptance-matrix)
including **L1**. The week stream from #499 stays; this retest must pass
**week hops → weekOrg → rest → publish** (prefer `gc`).

1. Keep `WORKFLOW_RUNTIME=cf-queue` and
   `WORKFLOW_QUEUE_ENQUEUE_URL=https://pre.gitstarclub.com/enqueue`. Do **not**
   PUT production schedules and do **not** stop Vercel cron.
2. Wait for any active lease to expire, or use a new idempotency key.
3. Bearer `GET https://pre.gitstarclub.com/api/workflows/refresh/start` → **200**
   `started` with a `run_id`.
4. Blob: week-pack + `recomputeRank-week-{0,8,…}` + `week-repo-carry` then
   terminal `recomputeRank-week.json`, `recomputeRank-weekOrg-*` /
   `recomputeRank-weekOrg.json`, `recomputeRank-rest.json`,
   `recomputeRank.json`, `publish.json` (prefer `gc.json`).
5. `active.json` stays `running` with this `fencing_token` until publish /
   `markPublished`. Must **not** write `error.json` with
   `could not read a consistent origin ETag while renewing`.
6. Confirm production Worker `triggers.crons` is still `[]`.

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

## CF refresh fold memory (Worker exceeded memory limit)

Preview evidence after #477 (CRON-PRE-PR477-RETEST-001): Bearer start 200,
preflight → whitelist → rename → metadata-0..31 → **`fold` ok** @ 11:15:03Z.
Then **recompute never started**. Observability `queue` origin silent after
fold; `workflow.advance` stops before `fold` → `recomputeRank`; same window
has **`Worker exceeded memory limit.`** on the **fetch** origin (the
service-bound step isolate, not the Queue consumer). Lease `expires_at`
stuck, no `error.json`.

Root cause (OOM **causes** the advance failure; #477's successor path is
still required):

1. **Fold was one isolate.** `foldCanonical` kept frozen pending month(s),
   then all 32 monthly shards, then `Promise.all` of every pending needed
   for weeks, then all 32 weekly shards. That is the first refresh step
   whose working set sits on top of OpenNext.
2. **Busted workflow reads were memoized.** `parseView` keyed by `bust=runId`
   retained those shards after `steps/fold.json` was written. #477 keeps the
   child isolate alive until the JSON body exists; the heap never dropped.
3. **The child died after the checkpoint.** Fetch-origin OOM ~9–25s after
   `fold.json` means `response.json()` never returned. The consumer did not
   `JOBS.send(recomputeRank)` and did not `workflow.advance`. Queue
   `max_retries: 2` then went silent. `failRefreshJob` never ran (isolate
   already gone) so there is no `error.json`.

Fix (keeps `WORKFLOW_RUNTIME=cf-queue`; does not roll back to HTTP):

- `runFoldStep` uses the preflight 4-bucket window (month shards, then week
  shards). Sequential pending absorb; compact `ops/workflows/<runId>/fold-week-plan.json`
  so later week windows do not reload every pending. `foldCanonical` still
  drains every window in-process (Vercel / tests).
- Workflow bust reads do not enter `parseView` memo; the step route calls
  `clearViewParseMemo()` before returning JSON.
- Step responses set `x-gitstarclub-queue-successor` **before** the body.
  If the body is lost to OOM/5xx after fold work, the consumer still
  `JOBS.send`s that job (next fold window or `recomputeRank`).
- Checkpoints are `fold-month-<seq>` / `fold-week-<seq>`; the last window
  also writes `steps/fold.json` so ops still sees a terminal fold file.

Production `triggers.crons` stays `[]`. Do not stop Vercel cron. Do not cut DNS.

## CF refresh fold still OOM after fold-month-0

Preview evidence after #479 (CRON-PRE-PR479-RETEST-PARTIAL-001): Bearer start
200, preflight → whitelist → rename → metadata-0..31 → **`fold` +
`fold-month-0` ok** @ 14:24:09Z. Then **no later fold window**: no
`fold-week-*`, no `recomputeRank` / publish / gc. Observability `queue`
origin silent after ~14:24:33Z; fetch-origin **`Worker exceeded memory
limit.` ×3** (14:20–14:35). Lease `expires_at` stuck at 14:53Z,
`successor` needle 0, no `error.json`.

Root cause relative to #479 (OOM still causes the advance failure):

1. **Each 4-bucket window still reloaded the full pending month.**
   `fold-month-0` parsed every `per_repo` daily series, then kept four
   monthly shards. Later windows did the same. The first window wrote a
   checkpoint; the next isolate (or a Queue retry of the same job) sat on
   OpenNext leftover heap and died before `fold-month-1`.
2. **Plan-build was mixed with the first shard window.** Week plan already
   existed, but month windows had no compact plan, so retries were never
   cheaper than the first hop.
3. **`max_retries: 2` plus the same heavy body.** Three memory-limit
   events match one attempt + two retries. After that the queue went
   quiet. `failRefreshJob` never ran.

Fix (keeps `WORKFLOW_RUNTIME=cf-queue`; does not roll back to HTTP):

- `FOLD_BUCKETS_PER_JOB = 1`. Each shard hop holds one monthly or weekly
  shard, not four.
- Compact `ops/workflows/<runId>/fold-month-plan.json` (per-bucket
  `[repo_id, flow]` + `daily_totals`). The first month hop writes only
  that plan. Later hops do not reread pending.
- Week-0 also writes only `fold-week-plan.json`. Later week hops do not
  reread pending. A retry after either plan exists writes one shard.
- `clearViewParseMemo()` at the start of each `runFoldStep` and after
  each shard write. Pending `per_repo` is deleted while the month plan
  is built.
- Successor header / consumer path from #477/#479 stay. Checkpoints
  remain `fold-month-<seq>` / `fold-week-<seq>`; the last window still
  writes `steps/fold.json`.

Production `triggers.crons` stays `[]`. Do not stop Vercel cron. Do not cut DNS.

## CF refresh plan hop did not land after #484

Preview evidence after #484 (CRON-PRE-PR484-RETEST-001): Bearer start 200,
preflight → whitelist → rename → metadata-0..31 → **`fold-month-0` + `fold.json`
ok** at the same instant `2026-09-20T15:32:57.670Z`. Then **no**
`fold-month-plan.json`, no later `fold-month-*` / `fold-week-*`, no
`recomputeRank` / publish. Observability fetch-origin **`Worker exceeded
memory limit.` ×3**; queue silent after ~15:33Z.

Root cause relative to #484 (the plan hop was **not** skipped by a bug, and
it did **not** OOM before writing the plan):

1. **There was no closed month to fold.** Live `canonical/v2/meta.json` is
   already `folded_through: { month: "2026-08", week: "2026-W35" }`
   (`generated_at` 2026-09-06). Current UTC month on the retest was
   `2026-09`. `nextMonth("2026-08") >= currentMonth` sends the first hop
   straight to week phase. August pending still exists (~2.4 MiB, 5519
   repos) as the frozen snapshot; monthly/weekly shards already contain
   `2026-08` / `2026-W35`.
2. **Week phase also had no work.** First Monday after W35 is 2026-08-31;
   no ISO week has Sunday ≤ end-of-August after that. `rows.length === 0`
   → `finishFold` without `fold-week-plan.json`.
3. **`fold-month-0` + terminal `fold.json` at the same timestamp** is
   `defaultCheckpoint` on that empty first hop (`hasNextFoldWindow` is
   false). #484's plan file is only written when a pending month is
   actually compacted.
4. **The OOM ×3 is the `recomputeRank` successor**, not fold. One isolate
   loaded every canonical family, including **~33 MiB of weekly shards**,
   then Zod-cloned them, then built month+week+year windows. Queue
   `max_retries: 2` matches three memory-limit events; no `recomputeRank.json`.

Fix (keeps `WORKFLOW_RUNTIME=cf-queue`; does not roll back to HTTP):

- First fold hop always writes `ops/workflows/<runId>/fold-decision.json`
  (`month_plan` / `pending_missing` / `week_only` / `no_closed_month` /
  `nothing_to_fold`) so a no-op fold is visible on Blob and is not mistaken
  for a missing plan hop.
- CF pending reads skip a second Zod walk of every daily series
  (`skipSchemaParse` + `coercePendingPeriod`); `monthPlanFromPending` still
  deletes `per_repo` as it walks.
- `recomputeRank` is three hops: month+year (repos+monthly), week
  (repos+weekly), rest (repos → all-time / newcomers / categories). CF
  model load is one shard at a time and does not Zod-clone preflighted
  shards. Entity/heatmap steps load only the families they need and write
  entities in chunks.

Production `triggers.crons` stays `[]`. Do not stop Vercel cron. Do not cut DNS.

## CF refresh recompute still OOM after #486

Preview evidence after #486 (CRON-PRE-PR486-RETEST-001): Bearer start 200,
preflight → whitelist → rename → metadata → **`fold-decision.json`
`reason=no_closed_month`** + same-instant `fold-month-0` + terminal `fold.json`.
That fold skip is **normal**. Then **no** `recomputeRank-month|week|rest` /
publish / gc. Observability fetch-origin **`Worker exceeded memory limit.` ×3**;
queue silent after ~23:58Z. `active.json` stayed `running` with an expired
lease. At handback `/preview/health` was 200 while `/` and `/rankings` were 500.

Root cause relative to #486 (the family split did **not** get the first
recompute hop onto Blob):

1. **The month hop still materializes an object window.** It loaded every
   repos + monthly shard into Maps, then `computeRepoWindow` built
   `byRepo` + `rowsByPeriod` (every repo × every month as heap objects),
   then derived the year window and two org windows, then held all rank
   views until `writeVersion`. Weekly (~33 MiB) was not in that isolate;
   the object graph plus fat repo meta (`description` / `languages` /
   `topics`) was enough to kill the fetch-origin step isolate before
   `recomputeRank-month.json`.
2. **Queue `max_retries: 2`** matches three memory-limit events. The
   consumer never saw a JSON body or successor header from a completed
   month hop, so there is no `workflow.advance` after fold.
3. **`/` and `/rankings` 500 are two causes, not one.**
   - **H1 (this issue / #494):** Those routes are OpenNext
     (`classifyWorkerRequest` → `next`). `/preview/health` is Worker
     shell. A fetch-origin step OOM recycles the shared Worker isolate;
     published `views/latest.json` is not rewritten until `publish`.
     Score **H1** only when **X1** is red. This is not a homepage data
     rewrite.
   - **H2 (#496, now on this branch via `pre`):** Period-scoped
     `liveHistory` used to throw when the chain exceeded 64 hops or the
     requested week/month was newer than the hop. That 500s `/` and
     `/rankings` with health 200 **without** a refresh OOM. #496
     fail-softs those walks (base / previous / empty). Cycle / schema /
     listed-but-missing still fail closed.

Fix (keeps `WORKFLOW_RUNTIME=cf-queue`; does not roll back to HTTP):

- Stream one repos-bucket + one monthly/weekly bucket at a time into a
  **packed typed-array window**. Rank hops slim repo meta (no
  description / languages / topics).
- Split `recomputeRank` into seven hops: `month` → `monthOrg` → `year`
  → `yearOrg` → `week` → `weekOrg` → `rest`. Each hop writes one product
  period-at-a-time and does not keep object windows + org + year together.
- Persist `ops/workflows/<runId>/recompute/{month,week}-win/` so later
  hops do not re-parse the raw monthly/weekly JSON. Fold writes
  `recompute-enqueued.json`; each rank hop writes
  `recomputeRank-<phase>-start.json` before load.
- Repo entities walk packed + one bucket of full repos / recent-daily.
  Org entities use the packed window. Lookups / all-time / search come
  from the rest hop's single repos load (validate stock consistency).

Production `triggers.crons` stays `[]`. Do not stop Vercel cron. Do not cut DNS.

## CF refresh week-start OOM after #497

Preview evidence after #497 (CRON-PRE-PR497-RETEST-001): Bearer start 200,
preflight → whitelist → rename → metadata → **`fold-decision.json`
`reason=no_closed_month`** → `recompute-enqueued.json`. Packed hops completed
`recomputeRank-month` / `monthOrg` / `year` / `yearOrg` and wrote
`recompute/{month,week}-win/0..31`. Then **`recomputeRank-week-start`** stayed
`running` for 21+ min. No `recomputeRank-week` / weekOrg / rest / terminal
`recomputeRank` / `publish` / `gc`. Observability fetch-origin **`Worker
exceeded memory limit.` ×3**; queue silent after ~02:04:40Z. Pages stayed 200
(#496 fail-soft).

Root cause relative to #497 (the seven packed hops did **not** get the week
isolate under the 128 MiB limit):

1. **Week cells are ~4× month cells.** The month hop fits a packed typed-array
   window. The week hop writes `recomputeRank-week-start` then
   `loadPackedRepoWindow("week")`. Building from weekly shards
   (`finalize` doubles ~every repo × every ISO week) or **re-assembling all 32
   persisted `week-win` JSON shards at once** (v1 nested `[periodIdx, flow,
   cum, stock]` arrays) plus the typed copy is what kills the fetch-origin
   isolate before `recomputeRank-week.json`.
2. **Queue `max_retries: 2`** matches three memory-limit events. After
   week-start the consumer never sees a JSON body or successor header, so
   there is no `workflow.advance` into weekOrg / rest / publish.
3. **`week-win/0..31` on Blob is not success.** Persist can finish (or a
   retry can see a completed persist) and the next assemble/rank still OOM.
   Score **X1** / **X2**, not “still packing”.

Fix (keeps `WORKFLOW_RUNTIME=cf-queue`; does not roll back to HTTP):

- Week pack is its own hop (`recomputeRank-week-pack`). It collects period
  names, then packs **one repo-bucket at a time** into a flat v2 persist
  (`recompute/week-win/{bucket}.json`) and never assembles the full week
  window.
- Week / weekOrg **stream one persist bucket** and rank an 8-period window
  (`recomputeRank-week-0`, `recomputeRank-week-8`, …). Prev-rank / org stock
  carry is a small `week-{repo,org}-carry.json`. Last window still writes
  terminal `recomputeRank-week.json` / `recomputeRank-weekOrg.json`.
- Month / monthOrg / year / yearOrg use the same per-bucket persist as week.
  Month pack writes flat v2 `month-win/` one repo bucket at a time and growth
  top-N in that hop. Year pack derives `year-win/` from those month buckets
  without assembling the month window. Rank hops stream 8 periods. Rest folds
  one `repos` bucket per hop, then writes all-time / lookup / search /
  categories from bounded carries and partials. Terminal
  `recomputeRank-month.json` / `monthOrg` / `year` / `yearOrg` / `rest` files
  are still written.

Production `triggers.crons` stays `[]`. Do not stop Vercel cron. Do not cut DNS.

## Preview Bearer full refresh acceptance matrix

预发 Bearer 全量 refresh 验收矩阵。This table is the current pass/fail gate
for a **preview Worker** (`gitstarclub-web-pre`) Bearer full refresh after
#486 / #494. Historical per-bug retest lists later in this document are
evidence of earlier stalls; they do not replace this matrix. Unit coverage
lives in [TESTING.md](./TESTING.md) (`#485` / `#494`).

This section does **not** enable Cloudflare production schedules, inject
secrets, stop Vercel cron, or deploy production `gitstarclub-web`.

### Hard constraints (every row)

| Constraint | Required state |
|---|---|
| Runtime | `WORKFLOW_RUNTIME=cf-queue` and `WORKFLOW_QUEUE_ENQUEUE_URL=https://pre.gitstarclub.com/enqueue` |
| Host | Preview only: `https://pre.gitstarclub.com` / Worker `gitstarclub-web-pre` |
| Auth | `Authorization: Bearer <CRON_SECRET>` (name only; never commit the value) |
| Production Worker `triggers.crons` | stays `[]` in top-level `wrangler.jsonc` (Worker `gitstarclub-web`) |
| Vercel production cron | `web/vercel.json` three rows stay scheduled. **Do not** stop Vercel cron |
| Production CF schedules | **Do not** `PUT` Cloudflare schedules on `gitstarclub-web` |

### Matrix

| ID | Surface | Pass | Fail |
|---|---|---|---|
| A1 | Bearer start | `GET https://pre.gitstarclub.com/api/workflows/refresh/start` → **200** `started` with a `run_id` (or `attached` to the same-week lease). Unauthenticated → 401 | 5xx, `ALPNProtocols` / `fetch failed`, Cloudflare 1102/503, or a start that never writes a lease |
| F1 | `fold-decision.json` | After the first fold hop, Blob **always** has `ops/workflows/<run_id>/fold-decision.json` with `reason` ∈ `month_plan` / `no_closed_month` / `pending_missing` / `week_only` / `nothing_to_fold` | Missing decision file after `fold-month-0` / `fold.json` |
| F2 | `no_closed_month` | `reason=no_closed_month` **and** no `fold-month-plan.json` **and** no `fold-week-plan.json` is **normal**. Current preview evidence after #484: `folded_through` already `2026-08` / `2026-W35` while UTC month is `2026-09`. Same-timestamp `fold-month-0` + terminal `fold.json` is the empty first hop, not a missing plan | Treating absent month/week plans as a stall when `reason=no_closed_month` |
| F3 | `month_plan` | If `reason=month_plan`: `fold-month-plan.json` plus more than one `steps/fold-month-*`, then `fold-week-plan.json` / `fold-week-*` when week work exists, then terminal `steps/fold.json` (`ok`) | `reason=month_plan` but no month plan / no later month windows |
| F4 | Other reasons | `week_only`: week plan present, month plan absent. `pending_missing` / `nothing_to_fold`: no month/week plan. All still require **F1** + terminal `fold.json` | Missing `fold.json` after a written decision |
| R1 | recompute hops | Queue consume continues after `fold.json`. Blob has `recompute-enqueued.json` then `steps/recomputeRank-month-start.json` (and later `*-start.json`). Checkpoints: `recomputeRank-month-pack.json` + `recomputeRank-month-0.json` (and later `recomputeRank-month-*`), terminal `recomputeRank-month.json`, `recomputeRank-monthOrg-0.json` (and later `recomputeRank-monthOrg-*`), terminal `recomputeRank-monthOrg.json`, `recomputeRank-year-pack.json` + `recomputeRank-year-0.json` (and later `recomputeRank-year-*`), terminal `recomputeRank-year.json`, `recomputeRank-yearOrg-0.json` (and later `recomputeRank-yearOrg-*`), terminal `recomputeRank-yearOrg.json`, `recomputeRank-week-start.json` + `recomputeRank-week-pack.json` + `recomputeRank-week-0.json` (and later `recomputeRank-week-*` period windows), terminal `recomputeRank-week.json`, `recomputeRank-weekOrg-0.json` (and later `recomputeRank-weekOrg-*`), terminal `recomputeRank-weekOrg.json`, `recomputeRank-rest-0.json` (and later `recomputeRank-rest-*` bucket / finalize hops), terminal `recomputeRank-rest.json`, then terminal `recomputeRank.json` (runtime names, not manifest aliases `recompute` / `buildAliases`) | Missing the enqueue/start evidence, missing any hop, silent after `fold.json`, stuck on `recomputeRank-week-start` with no `recomputeRank-week-pack` / `recomputeRank-week-*`, or a month/year/rest hop that assembles the full window |
| R2 | Families | Packed window (not object `RepoWindow`) from repos+monthly or repos+weekly. Month, year, and week hops must **not** assemble the full packed window: pack is per-bucket persist (year is derived from month buckets), rank is streamed persist + 8-period windows. Rest must **not** `loadCanonicalModel` every repo. Later: `recomputeRepoEntities` → `recomputeOrgEntities` → `recomputeHeatmap` → `aliases` → `validate` | One isolate loading every family, one isolate holding month+year+org object windows (the #486 OOM), one isolate assembling all `week-win` / `month-win` shards, or rest loading every repo meta |
| R3 | publish / gc | `steps/publish.json` (`ok`) then `steps/gc.json` (`ok`, or a written best-effort `error` field — `gc` never throws). `active.json` reaches `published`, or stays `running` with a **renewing** `expires_at` while later steps write. `markPublished` is the graph tail | No `publish.json` after rest; lease `status=running` with expired `expires_at` |
| L1 | Lease renew after week hops | Same `fencing_token` stays `running` through week-repo-carry → weekOrg → rest → publish. Origin body+etag is the fence; no `could not read a consistent origin ETag while renewing` | That error, or `active=failed` with this token after week hops while the run still owned it |
| H1 | Pages vs health (OOM isolate) | After fold, `/` and `/rankings` 500 while `/preview/health` 200 **and** **X1** is red is the **same** fetch-origin OOM isolate (OpenNext vs Worker shell), not a published-view rewrite. After a passing run (**X1** green) those pages stay 200 | Treating that page 500 as a separate rankings / liveHistory bug while **X1** is red |
| H2 | Pages vs health (liveHistory) | Independently, a page 500 with `live generation history exceeds 64 entries` (or a requested week/month newer than the hop) is the **#496** class. This branch already fail-softs those walks (merged from `pre`): pages fall back to base / previous / empty and stay 200. Score **H2** only when **X1** is green | Scoring a liveHistory 500 as **H1**/**X1** after a passing refresh, or requiring a published-view rewrite to explain it |
| X1 | OOM = fail | Fetch-origin `Worker exceeded memory limit` must **not** be a stable last event | Memory-limit ×N (Queue `max_retries: 2` → three events) then quiet |
| X2 | Queue silence = fail | Queue origin keeps consuming until `markPublished` or a written `ops/workflows/<run_id>/error.json` / `active.json` `failed` | Queue silent after fold or a recompute hop; no `error.json`; lease expires. **Do not** treat that as “still running” |
| P1 | Production crons | Top-level `triggers.crons` is `[]`. Preview `env.pre` may list three **draft** expressions; that is not platform enablement | Any production cron string, or a Cloudflare schedule on Worker `gitstarclub-web` |
| P2 | Vercel stays on | Production daily / weekly / start remain the three `web/vercel.json` rows | Stopping, emptying, or disabling Vercel cron as part of this acceptance |

### fold-decision reasons (quick key)

| `reason` | `monthPlan` / `weekPlan` | Month/week plan files | Notes |
|---|---|---|---|
| `month_plan` | true / false until week work | `fold-month-plan.json` required | Closed pending month compacted |
| `no_closed_month` | false / false | **none — normal** | `nextMonth(folded_through.month) >=` current UTC month; week rows also empty |
| `pending_missing` | false / false | none | Next closed month has no pending snapshot; hop goes to week |
| `week_only` | false / true | `fold-week-plan.json` only | No month work; week rows exist |
| `nothing_to_fold` | false / false | none | Week phase empty (no Sunday ≤ end-of-month after `folded_through.week`) |

### Operator procedure (scores the matrix)

1. Keep `WORKFLOW_RUNTIME=cf-queue` and
   `WORKFLOW_QUEUE_ENQUEUE_URL=https://pre.gitstarclub.com/enqueue`. Do **not**
   PUT production schedules and do **not** stop Vercel cron.
2. Wait for any active lease to expire, or use a new idempotency key
   (`?idempotency_key=` / `Idempotency-Key`).
3. Bearer `GET https://pre.gitstarclub.com/api/workflows/refresh/start` → score **A1**.
4. Workers Observability: `queue` consume after `fold.json`; `workflow.advance`
   shows `fold` → `recomputeRank` (month-pack → month period windows →
   monthOrg → year-pack → year period windows → yearOrg →
   week-pack → week period windows → weekOrg period windows → rest buckets) →
   entities → `publish` → `gc` → `markPublished`. Score
   **R1**, **R2**, **X1**, **X2**, **H1**, **H2**, **L1**.
5. Blob: score **F1**–**F4**, **R1**, **R3**, **L1**.
6. Confirm **P1** / **P2** on the committed wrangler file and the Vercel cron
   table (do not deploy production `gitstarclub-web` to “check”).
7. Any **Fail** cell fails the run. Silence without `error.json` is **X2**, not
   inconclusive.

### Suggested CF fold-decision + recompute follow-up retest (preview Worker only)

Score the run against the [acceptance matrix](#preview-bearer-full-refresh-acceptance-matrix).
The steps below are the historical operator procedure for the #486 follow-up;
the matrix is pass/fail.

1. Keep `WORKFLOW_RUNTIME=cf-queue` and
   `WORKFLOW_QUEUE_ENQUEUE_URL=https://pre.gitstarclub.com/enqueue`. Do **not**
   PUT production schedules and do **not** stop Vercel cron.
2. Wait for any active lease to expire, or use a new idempotency key
   (`?idempotency_key=` / `Idempotency-Key`).
3. Bearer `GET https://pre.gitstarclub.com/api/workflows/refresh/start` → **200**
   `started` with a `run_id`.
4. Workers Observability: `queue` consume continues **after** `fold.json`.
   `workflow.advance` should show `fold` → `recomputeRank` (month-pack →
   month period windows → monthOrg → year-pack → year period windows →
   yearOrg → week-pack → week period windows →
   weekOrg period windows → rest buckets) →
   `recomputeRepoEntities` → … → `publish` → `gc` → `markPublished`.
   Fetch-origin `Worker exceeded memory limit` must not be a stable last
   event. `/` and `/rankings` 500 with health 200 after fold **while X1
   is red** scores **H1** / **X1**, not a rankings rewrite. If **X1** is
   green and those pages still 500, score **H2** (`liveHistory` >64 /
   newer-than-head) — already fail-soft on this branch via #496.
5. Blob: `ops/workflows/<run_id>/fold-decision.json` is always present.
   If `reason=month_plan`, also expect `fold-month-plan.json` and more than
   one `steps/fold-month-*`, then `fold-week-plan.json` / `fold-week-*`.
   If `reason=no_closed_month` (current preview: already folded through
   2026-08 / 2026-W35), there is no month/week plan — that is the skip,
   not a stall. Then terminal `steps/fold.json` (ok), then
   `recompute-enqueued.json`, `steps/recomputeRank-month-start.json`,
   `recomputeRank-month.json`, `recomputeRank-monthOrg.json`,
   `recomputeRank-year.json`, `recomputeRank-yearOrg.json`,
   `recomputeRank-week-start.json`, `recomputeRank-week-pack.json`,
   `recomputeRank-week-0.json` (and later `recomputeRank-week-*`),
   terminal `recomputeRank-week.json`, `recomputeRank-weekOrg-0.json`
   (and later `recomputeRank-weekOrg-*`), terminal
   `recomputeRank-weekOrg.json`, `recomputeRank-rest.json`, terminal
   `recomputeRank.json`, then `publish.json` (`gc.json` if that step ran).
6. `active.json` should reach `published` (or stay `running` with a renewing
   `expires_at` while later steps write). A fold-then-silence stall with
   expired lease and no `error.json` is still the #479/#484 failure mode.
7. Confirm production Worker `triggers.crons` is still `[]`.

### Suggested CF week-start follow-up retest (preview Worker only)

Score the run against the [acceptance matrix](#preview-bearer-full-refresh-acceptance-matrix).
This is the operator procedure after #497 stalled on `recomputeRank-week-start`.

1. Keep `WORKFLOW_RUNTIME=cf-queue` and
   `WORKFLOW_QUEUE_ENQUEUE_URL=https://pre.gitstarclub.com/enqueue`. Do **not**
   PUT production schedules and do **not** stop Vercel cron.
2. Wait for any active lease to expire, or use a new idempotency key
   (`?idempotency_key=` / `Idempotency-Key`).
3. Bearer `GET https://pre.gitstarclub.com/api/workflows/refresh/start` → **200**
   `started` with a `run_id`.
4. Workers Observability: `queue` consume continues **after**
   `recomputeRank-week-start`. `workflow.advance` should show `recomputeRank`
   week-pack → `recomputeRank` week period windows → weekOrg windows → rest →
   entities → `publish` → `gc` → `markPublished`. Fetch-origin `Worker
   exceeded memory limit` must not be a stable last event. Queue silence after
   week-start is **X2**.
5. Blob: `recompute-enqueued.json`, month/year hop files as in **R1**, then
   `steps/recomputeRank-week-start.json`, `recomputeRank-week-pack.json`,
   `recomputeRank-week-0.json` (and later `recomputeRank-week-*`), terminal
   `recomputeRank-week.json`, `recomputeRank-weekOrg-0.json` (and later
   `recomputeRank-weekOrg-*`), terminal `recomputeRank-weekOrg.json`,
   `recomputeRank-rest.json`, terminal `recomputeRank.json`, then
   `publish.json` (`gc.json` if that step ran). `week-win/0..31` alone is
   **not** a pass.
6. `active.json` should reach `published` (or stay `running` with a renewing
   `expires_at` while later steps write). A week-start-then-silence stall with
   expired lease and no `error.json` is the #497 failure mode.
7. Confirm production Worker `triggers.crons` is still `[]`.

### Suggested CF fold-month-0 follow-up retest (preview Worker only)

1. Keep `WORKFLOW_RUNTIME=cf-queue` and
   `WORKFLOW_QUEUE_ENQUEUE_URL=https://pre.gitstarclub.com/enqueue`. Do **not**
   PUT production schedules and do **not** stop Vercel cron.
2. Wait for any active lease to expire, or use a new idempotency key
   (`?idempotency_key=` / `Idempotency-Key`).
3. Bearer `GET https://pre.gitstarclub.com/api/workflows/refresh/start` → **200**
   `started` with a `run_id`.
4. Workers Observability: `queue` consume continues **after** `fold-month-0`.
   `workflow.advance` should show several `fold` → `fold` hops (plan, then
   1-bucket month windows, week plan, week windows) → `recomputeRank` →
   `recomputeRepoEntities` → `recomputeOrgEntities` → `recomputeHeatmap` →
   `aliases` → `validate` → `publish` → `gc` → `markPublished`. No silent
   gap after the first month checkpoint. Fetch-origin `Worker exceeded
   memory limit` must not be a stable last event.
5. Blob: `ops/workflows/<run_id>/fold-month-plan.json`, then more than one
   `steps/fold-month-*`, then `fold-week-plan.json` / `fold-week-*`, then
   terminal `steps/fold.json` (ok), then `steps/recomputeRank.json` (and
   later `publish.json`; `gc.json` if that step ran).
6. `active.json` should reach `published` (or at least stay `running` with a
   renewing `expires_at` while later steps write). A fold-month-0-then-silence
   stall with expired lease and no `error.json` is the #479 failure mode.
7. Confirm production Worker `triggers.crons` is still `[]`.

### Suggested CF fold memory / advance retest (preview Worker only)

1. Keep `WORKFLOW_RUNTIME=cf-queue` and
   `WORKFLOW_QUEUE_ENQUEUE_URL=https://pre.gitstarclub.com/enqueue`. Do **not**
   PUT production schedules and do **not** stop Vercel cron.
2. Wait for any active lease to expire, or use a new idempotency key
   (`?idempotency_key=` / `Idempotency-Key`).
3. Bearer `GET https://pre.gitstarclub.com/api/workflows/refresh/start` → **200**
   `started` with a `run_id`.
4. Workers Observability: `queue` consume continues **after** fold windows.
   `workflow.advance` should show `fold` → `fold` (windows) → `recomputeRank`
   (then `recomputeRepoEntities` → `recomputeOrgEntities` →
   `recomputeHeatmap` → `aliases` → `validate` → `publish` → `gc` →
   `markPublished`). A `workflow.advance` with `via: "successor-header"`
   means the body was lost but the header still enqueued. No silent gap
   after the last fold checkpoint. Fetch-origin `Worker exceeded memory
   limit` must not be a stable last event.
5. Blob: `ops/workflows/<run_id>/steps/fold-month-0.json` (and later
   `fold-week-*`) then terminal `steps/fold.json` (ok) then
   `steps/recomputeRank.json` (and later `aliases.json`, `validate.json`,
   `publish.json`; `gc.json` if that step ran).
6. `active.json` should reach `published` (or at least stay `running` with a
   renewing `expires_at` while later steps write). A fold-then-silence stall
   with expired lease and no `error.json` is the old failure mode.
7. Confirm production Worker `triggers.crons` is still `[]`.

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
