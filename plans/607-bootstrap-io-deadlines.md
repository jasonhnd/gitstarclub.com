# Issue #607: Bootstrap store deadlines and contracts

## Goal

Bound signed R2 requests, including response bodies, so a stalled operation
cannot prevent upload retry or publication lease checks. Replace the cited
JSDoc `any` annotations with shared store and lease contracts and a generic
remote-stage result.

## Scope

Only the eight pipeline files listed in issue #607 may change, plus this plan
required by AGENTS.md. The R2 store uses a 30-second total request deadline;
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

## Progress and scope dependency

The request/body fix is committed at `ed124a7`. Verified frozen dependencies
and tool archives, 70 pipeline tests, the script typecheck, and whitespace
checks passed. Six separate removed-fix mutations failed with exit 1: unbounded
headers/body, no abort, no timer cleanup, a late body read, a restarted body
deadline, and missing deadline validation. Restoring the committed source
passed its entire R2 test file. All mutation copies and logs are temporary.

The shared contract draft exposes two existing unchecked consumers of
`runRemoteStage().result`: `pipeline/backfill/06-upload.mjs:136` and
`pipeline/backfill/07-export-v2.mjs:157`. A generic result must distinguish
`action: "dry-run"` (no result) from `action: "wrote"` (result of type T).
The script typecheck rejects both consumers with TS2339. Both files are outside
the issue's explicit allowlist, so neither has been edited in this checkout.

In an isolated temporary copy, one action guard at each consumer makes the
complete script typecheck pass with the drafted contracts. The scope needs to
include these two files so this can be committed without weakening the types.
The unapplied contracts, proposed two-line scope extension, exact diagnostics,
and mutation evidence are retained under `/tmp/GSC_0051/`. The checkout keeps
only the completed deadline fix and this plan until scope is resolved.

Full detached static/build verification, the PR, and independent review remain
pending the complete contract change. No live storage or deployment was used.
