# Issue #607: Bootstrap store deadlines and contracts

## Goal

Bound signed R2 requests, including response bodies, so a stalled operation
cannot prevent upload retry or publication lease checks. Replace the cited
JSDoc `any` annotations with shared store and lease contracts and a generic
remote-stage result.

## Scope

The eight pipeline files listed in issue #607 may change, plus this plan
required by AGENTS.md. The leader extended the scope on October 2, 2026 to
`pipeline/backfill/06-upload.mjs` and `pipeline/backfill/07-export-v2.mjs`,
strictly one action guard each. No other change is allowed in those entrypoints.
The R2 store uses a 30-second total request deadline;
tests inject a shorter deadline and fake fetch implementations. The deadline
must reject and abort even if the injected fetch or body ignores cancellation.
The deadline covers successful and error responses and is cleared on every exit.

## Out of scope

No page changes, dependencies, lockfiles, CI, deployment configuration, live
requests, credentials, real buckets, merges, or protected-branch pushes. Blob
transport behavior and all identity, conditional-write, publication, lease
fencing, first-commit, and rollback decisions remain unchanged.

## Steps

1. Install frozen dependencies with verified Node v24.20.0 and Bun 1.3.14;
   record this plan and commit it.
2. Add a bounded R2 request/body operation and injected-fetch regressions;
   verify pipeline tests and commit the completed behavior change.
3. Add shared store/lease JSDoc typedefs, type publication entry points, and
   preserve generic remote-stage results; typecheck and commit.
4. Verify removed-fix mutations in temporary copies. Run the full documented
   static job, fixture production build, and pre-only Wrangler dry run from a
   fresh detached checkout of the completed commit, in a clean environment.
5. Remove the verification checkout, confirm clean status, push only this issue
   branch, and open one PR to pre with Closes #607 and verification evidence.

## Acceptance

- Never-settling headers and bodies reject and receive an aborted signal within
  one total deadline, including writes, identity checks, and HTTP error bodies.
- Success and early failure release their timers; timeout errors contain no
  credentials or signed headers. Binary bytes and same-response ETags survive.
- Existing identity, conditional-write, lease fencing, initial publication,
  idempotency, and rollback tests pass.
- The two cited sites contain no JSDoc `any`; generic stage results and the
  shared contracts pass the script typecheck.
- Each behavior regression fails after its corresponding fix is removed.
- The complete AGENTS.md static/build flow passes; no lockfile churn or
  unrelated modifications remain. Independent high-risk review is required.

## Implementation and scope resolution

The request/body fix uses an AbortController and a promise race over the complete
response read. Its TimeoutError remains retryable by the existing upload retry
wrapper. The shared BootstrapStore, BootstrapSnapshot, and BootstrapLease
typedefs constrain byte reads, ETags, conditional writes, and fencing tokens.
Publication entrypoints use the capabilities they need, including the existing
retry wrapper. Remote stages and leased callbacks retain their generic results.

The shared contract exposed two existing unchecked consumers of
`runRemoteStage().result`: `pipeline/backfill/06-upload.mjs:136` and
`pipeline/backfill/07-export-v2.mjs:157`. A generic result must distinguish
`action: "dry-run"` (no result) from `action: "wrote"` (result of type T).
The script typecheck rejected both consumers with TS2339. The leader authorized
one guard at each consumer; the normal write path and the existing earlier
dry-run exits remain unchanged. This scope extension must be stated in the PR.

Frozen installs and the official tool archives were reverified after updating
to the current pre baseline. The complete pipeline suite passes 74 tests,
including structured stage results, failed lease release, missing lease
acquisition, and takeover preservation. The script typecheck passes. A temporary
TypeScript probe verifies both inferred stage/lease results and compile-time
rejection of invalid snapshot, ETag, and fencing-token types, plus access to a
dry-run result. The two cited sites have no JSDoc `any`.

Six separate removed-fix mutations failed with exit 1: unbounded headers/body,
no abort, no timer cleanup, a late body read, a restarted body deadline, and
missing deadline validation. Restoring the committed source passed the R2 test
file. Evidence and disposable copies are retained under `/tmp/GSC_0051/`.

Full detached static/build verification, the additional unmerged #589 offline
tests, and the PR follow this implementation commit. No live storage or
deployment is used. Independent high-risk review remains required.
