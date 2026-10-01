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
  and update the relevant testing documentation.

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
- Issue 572 is present through merged PR 581. PR 583 for issue 573 is still
  open and has no merge commit. The fetched baseline lacks
  `commitInitialBootstrapWithLease` and the post-renewal initial-commit checks.
- Implementation is blocked on that prerequisite landing in `pre`. Resume
  this card after fetching the updated integration branch; do not copy the
  prerequisite implementation into the issue 586 branch. No rehearsal command,
  full static run, real-bucket action, or pull request has been performed yet.
