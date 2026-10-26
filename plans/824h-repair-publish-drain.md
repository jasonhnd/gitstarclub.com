# Issue #824 follow-up: drain repair publication failures

## Goal

Finish all verification workers and heartbeat writes before releasing the repair
publication lease and removing its working directory.

## Scope

- Drain both bootstrap verification phases and preserve the first failure.
- Await pending heartbeat renewal before lease release, including failed renewal.
- Keep command scratch files until publication and release have settled.
- Count identical bytes found after a rate-limit wait as already present.
- Add deterministic fake-runner tests and update the operations runbook.
- Review the uploader, exporter, history importer, bootstrap-pointer command,
  local rehearsal worker, and repair publication callers for unchanged success.

## Out of scope

Bucket access, credentials, deployments, browser use, branch changes, repository
copies, pushes, merges, and changes to CI or deployment configuration.

## Acceptance

- A failing verification phase waits for its sibling's rate-limit wait and any
  later rejection, with no unhandled rejection and unchanged successful results.
- Heartbeat puts finish before failed or published release puts, including when
  renewal rejects; cleanup waits for workers and release on every command path.
- A post-429 exact-byte match counts as skipped rather than created.
- Run the requested frozen installs, full pipeline suite, and full web coverage
  suite, plus applicable static and local build checks on the current branch.
- The owner's current-branch and no-copy instructions override detached-clone
  verification. Use the requested /data/home/ktmp for logs and temporary output.

## Caller review

- `pipeline/backfill/06-upload.mjs`: still awaits one staging pool, with no
  publication lease and no changed staging result shape.
- `pipeline/backfill/07-export-v2.mjs`: still awaits canonical staging before
  acquiring its publication lease. The commit now drains both read phases;
  validation inputs and the pointer result are unchanged.
- `web/scripts/lib/aggregate-history-import.ts`: recovery and target phases
  remain sequential. Both verification pools now finish their guarded reads
  (including lease renewal) before the enclosing lease callback can release.
- `web/scripts/ensure-bootstrap-pointer.ts`: initial leased commits and ordinary
  commits retain their existing branches and successful result shape.
- `web/scripts/lib/r2-local-rehearsal-worker.ts`: its local initial-commit path
  still awaits the same helper and returns the same response.
- `web/scripts/repair-publish-commit.ts`: sealing, target verification, pointer
  commit and rollback all await the shared verifier. Both release entry points
  stop new heartbeats and settle any existing renewal before writing status.
- `web/scripts/prod-repair-build.ts` and `web/scripts/prod-repair-compare.ts`:
  local file verification retains the same successful manifests and totals.
- `web/lib/aggregate-history/worker.ts` retains its custom verifier and serial
  staging; `web/lib/workflows/refresh.ts` does not call this module.

The full pipeline suite covers offline upload/export, publication and rollback.
The full web suite covers the importer, bootstrap-pointer adapter, local initial
commit storage contracts, builder/comparison and guarded repair commands. No
caller needed a signature or successful result change.

## Verification

Implementation commit: `33f53c9`. All checks ran on the current branch
`ib/gsc-824h`, using Node v24.21.0 and Bun 1.4.2, in a clean environment without
live-test opt-ins. No repository copy or branch switch was used.

- Frozen installs passed without lockfile changes. The final full pipeline run
  passed all 211 tests across 12 files, including both new drain tests.
- The final full web coverage run passed 2,521 tests with 49 skipped and zero
  failures across 224 files. The coverage gate passed with 90.50% lines and
  91.06% functions. No unhandled rejection was reported.
- The final focused regression run passed all 182 tests across five files,
  including phase error ordering, real retry-boundary waits with fake timing,
  later sibling rejection, pending heartbeat success/failure, reacquisition,
  guarded retry skip accounting, and command cleanup/release ordering.
- Runtime and CI configuration assertions, host graph validation, web lint,
  all three typechecks, and generated-view fixture validation passed. Lint
  reported 14 warnings in unchanged files. Generated Worker declarations were
  temporarily excluded and restored to match CI's static-before-build order.
- Local production and pre builds and their matching host validations passed
  on the implementation commit: 234 routes and 467 artifacts per mode, using
  only the local GET/HEAD build fixture.
- Full static verification remains blocked by existing issues: documentation
  checks report ten unresolved performance-script references in five unchanged
  plans; the pipeline audit reports high-severity advisories for transitive
  undici 6.28.1 and zod 4.1.11. The web dependency audit passes. No dependency
  locks or unrelated plans were changed.
- Logs: `/data/home/ktmp/824h-final-requested-tests.log`,
  `/data/home/ktmp/824h-final-regression.log`,
  `/data/home/ktmp/824h-final-static.log`, and
  `/data/home/ktmp/824h-builds.log`.

No browser, credentials, bucket access, deployment, push or merge was used.
No product UI changed.
