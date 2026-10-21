# Issue 733: preview Worker aggregate import

## Goal

Deliver a reviewed implementation that can repair preview's sealed aggregate
history without creating, requesting or rotating credentials. This card stops
at one pull request into `pre`; deployment and execution require a follow-up.

## Scope and transport decision

Use authenticated, checksummed POST chunks to a preview-only Worker shell route.
The operator machine validates the pinned private manifest and all 65 source
files locally, then reuses `importAggregateHistory` for snapshot repair. Only
JSON snapshot/output objects and public manifest descriptors cross the wire.
The private export manifest and local paths never do. The Worker uses its
existing `DATA` binding and `CRON_SECRET`; there is no S3 credential dependency.

This is simpler than an upload/queue pipeline: no staging export inventory,
queue payload type, cleanup operation or Worker-wide in-memory repair is needed.
Snapshot reads, immutable staging and verification are separate bounded HTTP
invocations. Durable per-token chunk/verification checkpoints permit retries;
the local checkpoint records the lease token before further work. A lost or
expired lease cannot be resurrected, and a successor fences the old client.

Reuse the bootstrap lease, staging, manifest verification and commit helpers.
Extract bounded staging/verification primitives from those helpers without
changing their default behavior. Only complete durable verification proofs may
enter the normal commit helper. The Worker commit adapter additionally uses
compare-and-set or create-only for the publication pointer, rechecks the source
pointers and renews the shared lease immediately before publication.

## Steps

1. Record this plan and issue, after installing pinned dependencies.
2. Add bounded shared publication primitives and a preview-only authenticated
   Worker protocol with exact config and bound-bucket identity guards.
3. Add the operator transport/checkpoint support to the existing importer.
4. Cover replay, interrupted transfer, verification corruption, takeover,
   production refusal and 5,669-repository budgets; update the operator runbook.
5. Commit, run the complete AGENTS gate on the exact head in one fresh detached
   shared clone, remove generated artifacts, and open one PR for review.

Commit after each completed implementation step. Repository text stays English.

## Forbidden and out of scope

No deployment or real import; no production Worker/bucket/main operation; no
credential changes or requests; no new data coverage (lock-002); no cron/refresh
calls; no manual pointer edits; no protected pushes, merge, force-push or branch
deletion; no CI workflow, delivery/config, deploy-script, DNS, route, schedule or
secret change; no Wrangler/OpenNext command. GitHub Actions stays disabled.
No UI or product copy changes are planned.

## Acceptance and verification

- `DEPLOY_ENV=pre`, `R2_BUCKET=gitstarclub-data-pre`, the DATA binding's identity
  marker and the existing bearer are all required. Production returns 404
  before parsing input, authentication or any storage operation.
- No unconditional write to fenced/immutable paths; no caller-supplied pointer.
- Source checksums are pinned; uploaded chunks are bounded, checksummed and
  idempotent; durable verification is resumable and manifest-bound.
- Replay/resume, response loss, active leases, lease takeover, changed source
  pointers and corrupted staged bytes fail safely in tests.
- The fake physical subrequest counter covers 5,669 repositories and asserts
  every Worker invocation stays below budget, including commit and recovery.
- Run full AGENTS bootstrap/static and both fixture Vite builds plus host/graph
  validation on exact head under `env -i`. Keep live suites opted out. Skip
  `cf:dry-run` under the owner's NO WRANGLER order. Record every result in PR.
- Use the owner-approved shared toolchain/Bun caches; keep other temporary
  files in `.kanban-work/GSC_0159`, keep at most one verification clone, remove
  it promptly, and record final temporary-directory size and clean Git status.
- The PR closes #733, includes a verbatim deployment/import/verification
  runbook, and is handed to the independent review role with `PR merge` as
  `waitingOn`. Actual preview execution remains a follow-up card.
