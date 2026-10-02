# Issue 590: tests for untested operational scripts

## Goal

Add unit tests for the argument parsing, guards, and pure logic in the operational scripts listed on issue #590. Tests run under the existing `web` command `bun test lib/`, which is what CI `test:cov` already executes. Behavior of each script stays the same.

## Scope

Extract the pure helpers each script already inlines, keep the CLI output and exit behavior the same, and cover those helpers from `web/lib/ops-scripts/*.test.ts`:

- `web/scripts/blob-del-prefix.ts` (prefix refusal for `_meta/`, pointers, and the current generation; argv and confirm guards)
- `web/scripts/validate-views.ts`
- `web/scripts/validate-bootstrap-canonical.ts`
- `web/scripts/migrate-canonical-lifecycle.ts`
- `web/scripts/parity-recompute.ts`
- `web/scripts/resolve-preview.ts`
- `web/scripts/sync-blob-to-r2.ts`
- `web/scripts/geo-ai-log-report.ts`
- `web/scripts/lib/env.ts` (gaps left by `web/lib/script-env.test.ts`)

## Out of scope

These files are owned by other open work and must not change:

- `web/scripts/cf-opennext-build.ts`
- `web/scripts/ensure-bootstrap-pointer.ts`
- `web/scripts/generate-data-exports.ts`
- `web/scripts/validate-live-views.ts`
- `web/scripts/cf-build-identity.ts`

No network, no real object store, no BigQuery, no Cloudflare or Vercel API, no wrangler deploy, no CI workflow or `.delivery.yml` edits, no Worker wrangler config edits, and no `bun.lock` churn.

## Acceptance

- New tests are discovered by `bun test lib/` (the CI `test:cov` command). Evidence is the test file path in that run.
- The report lists the new test count and the functions those tests cover.
- Static verification follows AGENTS.md in a fresh detached worktree: the `static` job, including line and function coverage at least 80%.
- Pull request targets `pre`, contains `Closes #590`, and does not merge.
