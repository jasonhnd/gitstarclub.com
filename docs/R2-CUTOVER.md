---
owner: operations / storage
status: active
last_reviewed: 2026-10-01
source_of_truth_for:
  - R2 cutover runbook
  - current object-storage status
  - R2 stage plan and rollback
---

# R2 cutover

> **Current status:** Stage 1 (code) is done. Production still reads Vercel Blob on the **live** Worker until an authorized stage-4 deploy. A **2026-10-03 config batch** (below) prepares the checked-in stage-4 wrangler contract on `pre` without deploying production. Stages 2 through 6 are not accepted on production traffic.
>
> Storage sentence used across the current docs: Cloudflare R2 (production still reads Vercel Blob until cutover; see docs/R2-CUTOVER.md).

This file is the source of truth for where object storage is going and which stage is current. Historical P0 adapter notes live in [R2-MIGRATION-P0.md](./R2-MIGRATION-P0.md). The Blob publish and refresh design lives in [VERCEL-DATA-OPERATIONS.md](./VERCEL-DATA-OPERATIONS.md). Both are superseded for storage status. Blob layout and the environment inventory, still required until cutover, stay in [OPS.md](./OPS.md).

This document does not create buckets, change DNS, deploy a Worker, or write either store.

## 2026-10-03 migration batch (steps 1–3)

Jason 2026-10-03 resume: Blob → R2 migration is split from formal traffic cutover.

| Step | Owner | Scope | Accepted when |
| --- | --- | --- | --- |
| **1 — Write-path audit (read-only)** | Backend engineer | List every in-repo Blob **writer**, trigger, and whether it is still schedulable; explain freeze-period growth (e.g. `ops/sync-runs.json`). No code or schedule changes. | Report in Project store [`internal/r2-migration-20261003.md`](/cursor/stores/bc-c39797d3-b6a9-5c7b-a2c9-a4b3200fe6bf/internal/r2-migration-20261003.md) |
| **2 — Inventory + R2 copy** | BOT / operator | Blob object inventory and copy into `gitstarclub-data-prod` at bucket root. **Do not** use repo Cloudflare API copy from this agent run. | Jason confirms byte/key parity vs Blob |
| **3 — Config + docs (no deploy)** | Backend engineer | Draft PR on `pre`: top-level wrangler switches to stage-4 R2 vars (`R2_PUBLIC_BASE_URL=https://data.gitstarclub.com`, `DATA` → `gitstarclub-data-prod`, remove production `BLOB_*` and `VIEWS_VERSION_FALLBACK`). Update this file. **Keep PR draft; do not `wrangler deploy` production or merge to `main`.** | `node scripts/assert-cf-ci-gates.mjs` green on the PR branch |

**Not in steps 1–3 (explicitly deferred):**

- Production Worker deploy that would make `gitstarclub.com` read R2 (stage 4 cutover acceptance).
- Production `triggers.crons` enablement (stage 5).
- Blob store retirement (stage 6).
- Changing secret values, Bearer publish, or destructive Blob operations.

Formal cutover remains stage 4 deploy + acceptance after step 2 passes.

## Target model

Two data buckets, one per deployment:

| Deployment | Bucket | `DEPLOY_ENV` | Public read origin | Worker write |
|---|---|---|---|---|
| Preview (`pre`) | `gitstarclub-data-pre` | `pre` | `https://data-pre.gitstarclub.com` | `DATA` binding, `STORAGE_WRITE_DRIVER=r2_binding` |
| Production (`main`) | `gitstarclub-data-prod` | `production` | `https://data.gitstarclub.com` | `DATA` binding, `STORAGE_WRITE_DRIVER=r2_binding` (stage 4) |

Preview already sets `STORAGE_READ_DRIVER=r2` and `R2_PUBLIC_BASE_URL` to the preview origin. That read uses public HTTP and does not use a storage key. Production top-level config still uses the blob read driver and does not bind `DATA`.

The assets binding `MEDIA` on `gitstarclub-assets` is not the JSON store. The JSON Worker does not use `MEDIA` for views, canonical objects, or pointers.

Issue #569 records that both data buckets already exist and that each has `_meta/bucket-identity.json` at the bucket root. This change did not call the Cloudflare or Vercel APIs. On 2026-09-30 the two public origins above did not resolve from the authoring host. Stage 2 acceptance includes those origins answering the identity object. A wrangler variable is not proof that DNS is live.

`R2_PREFIX` stays empty. Objects live at the bucket root (`views/latest.json`, `bootstrap/latest.json`, `_meta/bucket-identity.json`).

### Five protection layers

1. **Separate buckets.** Preview config cannot name `gitstarclub-data-prod` or `data.gitstarclub.com`. Production config cannot name `gitstarclub-data-pre` or `data-pre.gitstarclub.com`. There is no shared data prefix that lets one deployment write the other bucket.
2. **`DEPLOY_ENV`.** An R2 put or delete requires `DEPLOY_ENV` of `production` or `pre`. Unset refuses the write, including on Cloudflare where `VERCEL_ENV` is never set. `VERCEL_ENV=production` refuses the write unless `DEPLOY_ENV=production`. `WORKFLOW_COLD_START` and `PREFLIGHT_RELAX_EMPTY_SHARDS` arm only when `DEPLOY_ENV=pre`.
3. **Bucket identity.** Before an R2 put or delete, the guarded store reads `_meta/bucket-identity.json` at the bucket root. `bucket` must equal `R2_BUCKET` and `deploy_env` must equal `DEPLOY_ENV` (`pre` or `production`). Application code never puts or deletes a key under `_meta/`. An operator places the marker out of band. The positive check is cached per isolate.
4. **Key shape.** Guarded put and delete reject `.` and `..` segments, including one percent-encoding (`%2e`, `%2e%2e`), so `new URL()` cannot collapse `views/../_meta/x` into `_meta/`. `del` of an `r2://` URL or a public URL under `_meta/` is refused before the marker is read.
5. **CI gates.** `node scripts/assert-cf-ci-gates.mjs` refuses a production bucket or domain inside preview `env.pre`, a preview bucket or domain at the top level, `BLOB_*` on preview, a missing preview `DEPLOY_ENV`, and a non-empty `R2_PREFIX`. Those host checks ignore case, so `DATA.gitstarclub.com` is still the production host. Until cutover, top-level `DEPLOY_ENV` must stay unset, and top-level `STORAGE_READ_DRIVER`, `READ_DRIVER`, `STORAGE_WRITE_DRIVER`, and `WRITE_DRIVER` must stay unset or `blob`. `cf:build` refuses a shell public read base that does not match the wrangler vars for `--site-target`. A loopback fixture (`127.0.0.1`, `localhost`, and a URL whose hostname is `[::1]`) stays allowed so CI can build.

Issue #578 prepares a separate stage-4 target contract without changing the current config. Top-level `DEPLOY_ENV=production` selects that contract: both explicit drivers, the production bucket var and public base, and exactly one `DATA` binding must match stage 4. Blob variables and `VIEWS_VERSION_FALLBACK` must be absent, and `R2_PREFIX` must remain unset or empty. Driver aliases, if present, must agree with the explicit drivers. A partial switch fails. Bucket/domain isolation, indexing, and the paused schedules remain enforced in both contracts.

The marker JSON is exactly one of:

```json
{"bucket":"gitstarclub-data-pre","deploy_env":"pre"}
{"bucket":"gitstarclub-data-prod","deploy_env":"production"}
```

Bootstrap and the listed web ops scripts add a CLI target on top of those layers. `--store r2` requires `--target prod|pre`. `--target` without `--store r2` is refused. Named buckets come from `R2_BUCKET_PROD` / `R2_BUCKET_PRE`. A single `R2_BUCKET` must match the target suffix. R2 writes nothing unless `--execute`. The scripts never write `_meta/`.

## Stage plan

Do not skip ahead. Each stage names the acceptance commands and the rollback. Commands that pass `--execute` or deploy a Worker are operator steps for that stage. They are not part of the stage 1 code landing, and this docs change does not run them.

### Stage 0. Stop-bleed

Done before the stage 1 code. Shared-store incident #543: production `views/latest.json` was missing, so the production Worker serves `VIEWS_VERSION_FALLBACK` (`refresh-2026-09-13T06-00-16-398Z`) only after a confirmed 404 of that pointer. Preview schedules are paused (`env.pre` `triggers.crons` is `[]`). Preview does not set `BLOB_*` or the fallback. Production `triggers.crons` stays `[]`.

Acceptance (read-only, still required):

```bash
node scripts/assert-cf-ci-gates.mjs
```

Rollback: do not point preview cron at the production blob store. Remove `VIEWS_VERSION_FALLBACK` only after `views/latest.json` exists on the store production is reading, using the removal steps in [OPS.md](./OPS.md). The fallback is not a pointer write.

### Stage 1. Code

Done on `pre`. Merged pull requests:

| PR | What landed |
|---|---|
| #558 | `DEPLOY_ENV` and the bucket-identity write guard (#557) |
| #560 | Hardening: no `_meta/` writes, `VERCEL_ENV=production` conflict, fixture refresh requires `DEPLOY_ENV` on Cloudflare (#559) |
| #562 | Worker `DATA` binding driver `r2_binding`; dot-segment refusal (#561) |
| #564 | Driver-aware reads and config checks (#563) |
| #566 | Pipeline R2 bootstrap, `--target prod\|pre`, dry run by default, `--initial-commit` (#565) |
| #568 | Preview Worker `env.pre` reads `gitstarclub-data-pre` at the preview public origin (#567) |

Acceptance for this stage is the required GitHub checks `static` and `production-build`, plus:

```bash
node scripts/assert-cf-ci-gates.mjs
bun run lint:docs
```

Unset drivers and `blob` still behave as the blob store. Preview `env.pre` sets `STORAGE_READ_DRIVER=r2`, `STORAGE_WRITE_DRIVER=r2_binding`, `DEPLOY_ENV=pre`, `R2_BUCKET=gitstarclub-data-pre`, and `MIN_TRACKED_STARS=10000`. It does not set `BLOB_*`, `VIEWS_VERSION_FALLBACK`, `WORKFLOW_COLD_START`, or `PREFLIGHT_RELAX_EMPTY_SHARDS`.

Rollback of the code is a revert of those pull requests on `pre`. Do not roll production back by editing `main` from this stage. Production was not switched.

### Stage 2. Preview rehearsal

Not accepted. Load the preview bucket, then prove the preview site reads it. Dry run first. `--execute` is an operator action and needs the bucket-scoped key outside the repository.

**Before the real-bucket rehearsal, run the offline local rehearsal first.**
Use the SHA-256-verified Node v24.20.0 and Bun 1.3.14 bootstrap in
[AGENTS.md](../AGENTS.md), with dependencies installed in both `web/` and
`pipeline/` using `bun --no-env-file install --frozen-lockfile`. From the
repository root:

```bash
cd web
bun --no-env-file scripts/r2-local-rehearsal.ts
```

Success prints `R2_LOCAL_REHEARSAL_OK` and exits 0. Any failed assertion or
timeout exits non-zero. Each run creates a private fixture project and HOME,
uses Miniflare's built-in local S3 and public R2 services with a persistent
workerd bucket, restarts that Worker to prove persistence, then removes its
own scratch directory. Miniflare is already installed by wrangler. The
entrypoint accepts no remote endpoint, bucket, or credential arguments.
Telemetry and remote bindings are disabled. Worker outbound reads are limited
to the local R2 service. Local S3 signing uses fabricated fixture values that
are valid only inside that Miniflare instance.

The rehearsal runs the actual `06-upload.mjs` and `07-export-v2.mjs` entrypoints
in a fixture mirror containing no environment files. It proves dry-run leaves
the bucket unchanged, upload and stage-only leave the pointer absent, and
initial commit publishes `previous_generation: null` and releases the shared
lease. A standalone Worker bundles the application read, storage, and lease
modules: with `STORAGE_READ_DRIVER=r2` and `STORAGE_WRITE_DRIVER=r2_binding`,
rankings resolve from the bootstrap generation while `views/latest.json` is
absent. The `DATA` write path claims, renews, and releases the workflow lease;
current pointer CAS succeeds and stale CAS is refused. Both pipeline and Worker
refuse a production identity and a different existing pointer. The Worker also
refuses mixed state and a marker introduced during initial-commit renewal.
Its bootstrap adapter reads staged parquet as bytes through `DATA`.

This local command is a prerequisite for the operator rehearsal. Stage 2 still
requires the real public origins and preview site acceptance below. The
standalone Worker exercises data paths; the full Next/OpenNext page server and
shared Next request cache are outside this command. CI workflows and required
checks are unchanged. See [TESTING.md](./TESTING.md#local-r2-stage-2-rehearsal).

From `pipeline/`, replace the generation id with the one the local build produced:

```bash
node backfill/06-upload.mjs --store r2 --target pre --generation bootstrap-YYYYMMDDTHHMMSSZ
node backfill/06-upload.mjs --store r2 --target pre --generation bootstrap-YYYYMMDDTHHMMSSZ --execute
node backfill/07-export-v2.mjs --store r2 --target pre --generation bootstrap-YYYYMMDDTHHMMSSZ --execute --stage-only
node backfill/07-export-v2.mjs --store r2 --target pre --generation bootstrap-YYYYMMDDTHHMMSSZ --execute --initial-commit
```

`--initial-commit` is allowed only when `bootstrap/latest.json`, `views/latest.json`, and `canonical/v2/meta.json` are all absent. It stores `previous_generation: null`. That null is not a legacy-flat rollback. `--rollback legacy-flat` fails closed on this bucket. A retry of the same generation returns already-published. `web/scripts/ensure-bootstrap-pointer.ts --execute --initial-commit` uses the same publication lease as step 07 before that create-only write.

Acceptance:

- `https://data-pre.gitstarclub.com/_meta/bucket-identity.json` is `{"bucket":"gitstarclub-data-pre","deploy_env":"pre"}`.
- After the initial commit, `https://data-pre.gitstarclub.com/bootstrap/latest.json` returns 200 and names that generation.
- `https://pre.gitstarclub.com/` returns 200 and is `noindex`.
- Deployment identity must equal the commit that was actually deployed. `https://pre.gitstarclub.com/.well-known/deployment` `commitSha` equals the SHA baked by the preview `cf:build` for that deploy. A runtime `CF_PREVIEW_COMMIT_SHA` or `VERCEL_GIT_COMMIT_SHA` counts only when it names that same commit.
- `node scripts/assert-cf-ci-gates.mjs` still passes. Preview still has no `BLOB_*`.

Rollback (operator, same generation, only after that generation was committed):

```bash
node backfill/07-export-v2.mjs --store r2 --target pre --rollback bootstrap-YYYYMMDDTHHMMSSZ --execute
```

Do not delete `_meta/`. Do not point the production Worker at this bucket. If the public origin still does not resolve, fix DNS in a separate authorized change before calling the rehearsal accepted. Do not use the production blob URL as a stand-in.

### Stage 3. Production rebuild

Not accepted. Repeat the stage 2 commands with `--target prod` into `gitstarclub-data-prod` only after the preview rehearsal is accepted. The production Worker keeps reading Vercel Blob until cutover. Do not bind `DATA` on the top-level Worker in this stage. Do not export the preview public origin for a production build.

Acceptance:

- `https://data.gitstarclub.com/_meta/bucket-identity.json` is `{"bucket":"gitstarclub-data-prod","deploy_env":"production"}`.
- `https://data.gitstarclub.com/bootstrap/latest.json` and the published views pointer return 200 for the generation that was committed.
- Production `https://gitstarclub.com/` still returns 200 from the blob read path. Top-level Worker config still has no `DATA` binding and still sets the blob public base.

Rollback: `07-export-v2.mjs --store r2 --target prod --rollback <generation> --execute` for that generation. Leave production drivers on `blob`. Do not delete the identity marker or the blob objects.

### Stage 4. Cutover (I-5b)

Not accepted. This is the production read and write switch. It is a Worker config change, not a docs change:

- Bind `DATA` to `gitstarclub-data-prod` on the top-level Worker.
- Set `DEPLOY_ENV=production`, `STORAGE_READ_DRIVER=r2`, `STORAGE_WRITE_DRIVER=r2_binding`, `R2_BUCKET=gitstarclub-data-prod`, and `R2_PUBLIC_BASE_URL=https://data.gitstarclub.com`.
- Remove production `BLOB_BASE_URL`, `NEXT_PUBLIC_BLOB_BASE_URL`, and `VIEWS_VERSION_FALLBACK` only after the R2 pointer exists and pages render from it. The fallback must not keep serving the frozen 2026-09-13 version once a real pointer is in place.
- Keep `triggers.crons` at `[]` until stage 5.
- Keep `MEDIA` on `gitstarclub-assets`. Do not use it as the data bucket.

Acceptance:

- `node scripts/assert-cf-ci-gates.mjs` passes, including the rule that preview config does not name the production bucket.
- `https://gitstarclub.com/rankings` returns 200 with indexing still on.
- The generation in `https://data.gitstarclub.com/views/latest.json` matches what the production pages render.
- A production shell build exports both `STORAGE_READ_DRIVER=r2` and `R2_PUBLIC_BASE_URL=https://data.gitstarclub.com`. OpenNext prerendering inherits the shell, not the Worker vars. `cf:build` rejects a missing or different read driver, a missing public base, any shell `BLOB_*` variable (including `NEXT_PUBLIC_BLOB_*`), or a non-loopback base that does not match the top-level wrangler vars.

After the separately authorized stage-4 config change, the read-only production build environment is:

```bash
export STORAGE_READ_DRIVER=r2
export R2_PUBLIC_BASE_URL=https://data.gitstarclub.com
unset READ_DRIVER BLOB_BASE_URL NEXT_PUBLIC_BLOB_BASE_URL BLOB_READ_WRITE_TOKEN
cd web
bun run cf:build:production
```

Do not run this against the current Blob Worker config: the target mismatch must fail. Clear any other `BLOB_*` or `NEXT_PUBLIC_BLOB_*` shell vars as well. No write driver or storage credential is needed for this build. Offline tests use an R2 loopback base with the same explicit read driver and no Blob vars.

Rollback: restore the previous top-level blob public base, remove the production `DATA` binding, and set the read and write drivers back to `blob` (or unset them). Do not delete blob objects. Do not empty the production R2 bucket as part of rollback.

### Stage 5. Production crons

Not accepted. After stage 4, and only with an explicit owner approval, set production `triggers.crons` to the three intended expressions (`0 3 * * *`, `0 4 * * SUN`, `0 6 * * SUN`). Cloudflare numbers Sunday as `1` or `SUN` and rejects `0`. Do not use `7` for Sunday (`7` is Saturday).

Acceptance: the production Worker schedule shows those three expressions, a completed run writes the production R2 bucket, and `node scripts/assert-cf-ci-gates.mjs` is updated in the same change that enables the crons so the empty-array contract is not left stale. Preview `triggers.crons` stays `[]` until the owner separately re-enables preview schedules.

Rollback: set production `triggers.crons` back to `[]` and redeploy that config. The `web/vercel.json` declarations stay as the scheduler rollback reference until stage 6. Do not call production cron as a substitute for the config rollback.

### Stage 6. Retire Blob

Not accepted. After production has been on R2 through at least one successful refresh, remove the remaining blob operating dependency:

- Production and preview do not require `BLOB_READ_WRITE_TOKEN` or `BLOB_BASE_URL`.
- Live release gates stop falling back to the public blob URL. They use `LIVE_PUBLIC_READ_BASE_URL` or the R2 public origin. That fallback is documented as temporary in [OPS.md](./OPS.md).
- Blob layout instructions in [OPS.md](./OPS.md) and the superseded Blob design doc move to history.
- `exports:generate` and `validate-live-views.ts` use `getPublicReadBases()` for the configured read driver. The validator checks the primary origin and reports `storage_read_driver` and `public_read_base`. Their offline CLI regression tests run with an R2 loopback base and no Blob vars; a missing R2 base fails even when a Blob base is available. This preparation does not retire the remaining Blob operating dependencies.

Acceptance: the top-level Worker config and preview `env.pre` contain no `BLOB_*` vars, a read-only production page still returns 200 from `https://data.gitstarclub.com`, and the read-only export and live-view tools succeed with the R2 driver without Blob vars. A page returning 200 alone does not verify those tools.

Rollback: restore the blob driver and the blob public base on the production Worker, as in stage 4 rollback. Do not delete blob objects in order to roll back. Deleting the blob store is a separate owner decision after this stage has stayed healthy. It is not the rollback.

## What is still blob, until cutover

Production page reads, production cron writes, and the production build prerender still use the blob driver. Keep those runbooks. They are labelled until cutover in [OPS.md](./OPS.md), [README.md](../README.md), and the other current docs. Do not delete them in stage 1.

Local read-only development against the blob driver still needs only `BLOB_BASE_URL` until cutover. Preview reads do not use a blob token. R2 writes need `DEPLOY_ENV`, the matching identity marker, and either the `DATA` binding (`r2_binding`) or the S3 key (`r2` / `r2_s3`). Never commit the key.
