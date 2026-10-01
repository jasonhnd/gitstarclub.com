# Issue #578: Prepare the stage-4/6 R2 contracts

## Goal

Make the CI gate, read-only data tools, and production build checks ready for
the documented R2 cutover without changing the deployed storage configuration.

## Scope

- Add a strict, tested production stage-4 contract to `scripts/cf-ci-gates.mjs`
  and its tests. Preserve the current Blob contract and environment isolation.
- Use `getPublicReadBases()` in `web/scripts/generate-data-exports.ts` and
  `web/scripts/validate-live-views.ts`, including driver-aware local env loading.
- Assert that a stage-4 production OpenNext build receives an explicit R2 read
  driver and production public base. Test the existing Blob and loopback paths.
- Add offline subprocess tests for both data tools, without Blob variables.
- Update the cutover runbook and record verification in this plan and the PR.

## Out of scope

No Worker config values, CI workflows, delivery settings, dependencies, live
data, schedules, deployment, credentials, or production cutover are changed.
Do not merge, force-push, delete branches, or push protected branches.

## Baseline

- Start: `origin/pre` at `b9650f063895c9eaf97ea91eb57c3882f89ce23c`.
- Branch: `feat/578-r2-stage4-ready`; PR target: `pre`.
- Parent cards GSC_0020, GSC_0021, and GSC_0022 are done. PRs #579 and #581
  are merged; #583 remains open at the start of this task.
- Audit findings A08 and A14 were checked against this baseline. The gate
  requires production Blob vars and the frozen views fallback; both tools
  explicitly require a Blob public base. These findings still apply.

## Steps

1. Commit this plan.
2. Implement and test the production storage contract and build assertions;
   commit the completed step.
3. Implement driver-aware read-only tools and offline regression tests; update
   the runbook and commit the completed step.
4. Verify the committed result in a fresh detached worktree using the exact
   AGENTS.md toolchain and clean environment. Prove the new tests fail with
   the baseline implementations restored in that disposable tree.
5. Remove the verification tree, record results, open one PR against `pre`,
   and hand off to the reviewer through GSC_0027.

## Acceptance

- The checked-in configuration passes `node scripts/assert-cf-ci-gates.mjs`.
- A complete in-memory stage-4 config passes; partial cutovers, Blob remnants,
  incorrect drivers, buckets, prefixes, and cross-environment domains fail.
- Production stage-4 builds require `STORAGE_READ_DRIVER=r2` and the target
  R2 public base; no implicit Blob fallback is accepted.
- Both data-tool subprocesses succeed against a GET/HEAD-only loopback
  fixture with no `BLOB_*` or `NEXT_PUBLIC_BLOB_*` environment variables.
- The full static job, fixture production build, and preview `cf:dry-run`
  pass using Node v24.20.0 and Bun 1.3.14 in a fresh detached worktree.
- Behavioral regression tests fail after restoring baseline implementations.
- No lockfile changes or forbidden-file changes are committed.

## Verification

- The checked-in configuration passes `node scripts/assert-cf-ci-gates.mjs`.
- Four stage-4 gate tests pass with
  `node --test --test-name-pattern='production stage-4 storage contract' scripts/cf-ci-gates.test.mjs`.
- At `8987461`, a fresh detached worktree and the SHA-256-verified Node
  v24.20.0 / Bun 1.3.14 toolchain under `env -i` passed all 34 CF gate/build
  tests and all four data-tool subprocess tests (35 assertions).
- Behavioral negative probes at `8987461` restored each baseline implementation
  from `b9650f0` in that disposable tree, kept the new tests, and restored the
  fixed file after each probe. All four commands exited 1 as required:

| Restored implementation | Regression command | Observed failure |
| --- | --- | --- |
| `scripts/cf-ci-gates.mjs` | `node --test --test-name-pattern="accepts the complete R2 cutover" scripts/cf-ci-gates.test.mjs` | The complete stage-4 config still requires Blob/fallback vars and rejects R2 drivers. |
| `web/scripts/cf-opennext-build.ts` | `node --test --test-name-pattern="cf:build stage-4" scripts/cf-ci-gates.test.mjs` | Missing shell read driver is incorrectly accepted. |
| `web/scripts/generate-data-exports.ts` | `cd web && bun test --test-name-pattern="exports CSV and JSON through R2" lib/integration/r2-data-tools.test.ts` | Missing Blob public base prevents R2 exports. |
| `web/scripts/validate-live-views.ts` | `cd web && bun test --test-name-pattern="validates the published live generation" lib/integration/r2-data-tools.test.ts` | Missing Blob public base prevents R2 live-view validation. |

The issue PR and card handoff are the record for the final full static job,
fixture builds, tested SHA, and worktree cleanup. They do not claim live R2
rehearsal or deployment acceptance.
