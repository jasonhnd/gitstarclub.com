# Issue 586: local R2 stage 2 rehearsal

## Goal

Rehearse stage 2 against a persistent local Miniflare/workerd R2 bucket before
the real preview-bucket rehearsal. Exercise the pipeline upload, staging, and
initial commit; Worker reads from the bootstrap generation; and Worker lease
and pointer writes with workerd's actual conditional ETag semantics.

## Scope

- A repeatable local command and fixture support under `web/scripts/` and
  regression tests under `web/lib/storage/` as needed.
- Run the actual `pipeline/backfill/06-upload.mjs` and `07-export-v2.mjs`
  entrypoints against fixture data in an isolated local directory.
- Document the required local rehearsal in stage 2 of `docs/R2-CUTOVER.md`
  and update the relevant testing documentation and local-tool environment
  inventory in `docs/OPS.md`.
- Fill the binding driver's missing byte-preserving `getBytes` method, exposed
  by the local Worker bootstrap check, and cover it against real workerd.

## Out of scope

- Cloudflare or Vercel API calls, real data buckets, credentials, and deploys.
- Reading environment files in pipeline or web, or any credential files.
- CI workflows, `.delivery.yml`, and Worker wrangler configuration values.
- Lockfile churn, merging pull requests, force-pushing, deleting branches,
  and pushing `main`, `pre`, or `preview`.
- Reimplementing or copying the prerequisite fixes from issues 572 and 573.

## Acceptance

- Dry runs leave the local bucket unchanged. Stage-only uploads do not create
  `bootstrap/latest.json`; the first commit publishes `previous_generation: null`.
- With `views/latest.json` absent, Worker reads resolve fixture rankings from
  the committed bootstrap generation through the R2 read path.
- The `r2_binding` write path claims, renews, and releases
  `ops/workflows/active.json`, and rejects stale pointer CAS writes using real
  workerd conditions.
- A preview-target run rejects a production identity marker; initial commit
  rejects a different existing pointer and mixed published state.
- Removing the prerequisite fixes causes the new regression checks to fail;
  record the mutation commands and failure evidence.
- Run the complete `AGENTS.md` static job and fixture builds on the tested
  commit in a fresh detached worktree with Node v24.20.0 and Bun 1.3.14.
- Open one pull request against `pre`, with `Closes #586`, the verification
  results, and remaining limitations. Hand off to the reviewer without merging.

## Preparation and dependency status

- GSC_0021 and GSC_0022 are both marked done in Kanban.
- Fetched `origin/pre` and created `test/586-r2-local-rehearsal` from
  `b9650f063895c9eaf97ea91eb57c3882f89ce23c` on 2026-10-01.
- Verified the official Node/Bun archives with the `AGENTS.md` bootstrap and
  installed both web and pipeline dependencies with frozen lockfiles and
  environment-file loading disabled. No lockfile changes were produced.
- Initially blocked because issue 573 had not landed in `pre`. PR 583 merged
  as `ae9dae4` on 2026-10-01T13:12:29Z. Resumed the same card and rebased the
  plan onto freshly fetched `origin/pre` (`aa175a8`, also containing the
  unrelated dependency-security update). No prerequisite code was copied.
- The first local run reached the binding initial-commit path and failed with
  `object store cannot read binary objects` because the binding store lacked
  `getBytes`. Commit `ceda546` supplies byte-preserving reads and a real-workerd
  regression; both binding test files passed (17 tests).
- The standalone command now passes all local stages and exits 0 with
  `R2_LOCAL_REHEARSAL_OK`. Full static verification and mutation evidence are
  recorded separately for the final tested commit before the pull request.

## Mutation verification

Use a disposable verification checkout. Run the same local command after each
change, require a non-zero exit with the expected behavioral assertion, then
restore the source before the next mutation and the full static run:

1. Remove the binding `getBytes` method: bootstrap must fail its binary read,
   rather than proceeding to publication.
2. In `onlyIfFor`, pass `options.ifMatch` directly instead of
   `etagForBindingCondition(options.ifMatch)`: real workerd must reject the
   quoted structured condition on Worker renewal.
3. Make `commitInitialBootstrapWithLease` call `commitBootstrapGeneration`
   directly with `initialCommit: true`, bypassing the shared lease: the active
   workflow refusal must fail because the pointer is incorrectly published.
4. Remove the second `assertInitialCommitTarget` after renewal: a marker
   inserted during renewal must incorrectly publish and fail the race check.

The fixture's marker injection changes a local `DATA` object at the relevant
renewal read; it does not simulate ETags or replace workerd's CAS conditions.
