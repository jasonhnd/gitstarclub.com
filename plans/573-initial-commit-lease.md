# Issue 573: initial-commit publication lease

## Goal

`web/scripts/ensure-bootstrap-pointer.ts --initial-commit` must publish through the same `ops/workflows/active.json` CAS lease and fencing token as `pipeline/backfill/07-export-v2.mjs`. A running workflow blocks the commit. A marker or pointer written between the empty-bucket check and the create-only pointer write is refused. An empty bucket still publishes `previous_generation: null`.

## Scope

- `web/scripts/ensure-bootstrap-pointer.ts`: the R2 `--execute --initial-commit` path calls the shared helper. Dry-run and Blob repair stay as they are.
- `pipeline/lib/bootstrap-publication.mjs`: add `commitInitialBootstrapWithLease`, which takes `withBootstrapPublicationLease` (`operation` `publish`) and passes `assertCanCommit` into `commitBootstrapGeneration`. After that renewal, re-read `bootstrap/latest.json`, `views/latest.json`, and `canonical/v2/meta.json` before the create-only write.
- Tests in `web/lib/storage/initial-bootstrap-commit.test.ts` use the in-memory object store and the bootstrap adapter. They do not contact a network or a real bucket.
- Operator notes in `docs/OPS.md`, `docs/PIPELINE.md`, `docs/TESTING.md`, and `docs/CHANGELOG.md`.

## Out of scope

- `web/lib/storage/r2-binding-store.ts` (issue #572).
- CI workflows, `.delivery.yml`, and Worker wrangler config.
- Cloudflare, Vercel, wrangler deploy, and real bucket writes.
- Changing the Blob `--execute` path that repairs a missing pointer without `--initial-commit`.
- Merging the pull request, or pushing `pre` or `main`.

## Acceptance

- A running `ops/workflows/active.json` refuses publication and leaves the pointer absent.
- A concurrent write of `views/latest.json` or `bootstrap/latest.json` during the lease renewal is refused.
- A stolen fencing token during that renewal is refused.
- An empty bucket still publishes, then the lease is released as `published` with the pipeline idempotency key `bootstrap:publish:<generation>`.
- New tests fail if the helper publishes without the lease.
- The static job in `AGENTS.md` passes in a fresh detached worktree.
