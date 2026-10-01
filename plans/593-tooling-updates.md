# Issue #593: routine build and test tooling updates

## Goal

Update Wrangler, PostCSS, sharp, Playwright, and the Node 24 types to the
latest stable versions available when implementation starts. Keep
`@types/node` on the 24 line. Deliver one feature branch and one pull request
against `pre`, after the GSC_0038 / issue #592 changes have landed there.

## Scope

- Update the five requested dependency declarations or overrides in
  `web/package.json` and their resolved packages in `web/bun.lock`.
- Preserve the existing security overrides and unrelated dependency versions.
- Update relevant dependency/testing documentation and this plan with the
  before/after version table, verification evidence, and remaining limitations.
- Record sharing-image output and any Playwright/browser baseline changes.

## Out of scope

Do not upgrade Node beyond 24, Bun, Next, OpenNext, React, Zod, Three, or
pipeline dependencies. Do not change CI workflows, `.delivery.yml`, Worker
configuration, or deployment scripts. Do not deploy, upload Worker versions,
call Cloudflare/Vercel APIs or production endpoints, access real data stores,
read environment files or credentials, merge PRs, force-push, or push directly
to `main`, `pre`, or `preview`. No branch deletions or unrelated file deletions.

## Steps

1. Fetch `origin/pre`, verify the prerequisite has landed, bootstrap the
   SHA-256-verified Node 24.20.0 and Bun 1.3.14, and install frozen dependencies
   in the fresh task checkout without environment files.
2. Recheck npm stable versions, update only the requested tooling packages,
   inspect the lockfile diff, and commit the dependency update.
3. Run the complete `AGENTS.md` static job, fixture production build, and
   `cf:dry-run` on the resulting commit in a fresh detached verification
   worktree under `env -i`. Audit both `web` and `pipeline` at moderate severity.
4. Verify sharing-image PNG output and compare Playwright baselines against
   the prerequisite baseline with local fixture data. Document browser-version
   changes and any visual differences without silently replacing baselines.
5. Commit the verification report, push only `chore/593-tooling-updates`, and
   open a PR to `pre` containing `Closes #593`, changes, commands/results, and
   unfinished or uncertain work. Hand off to a Claude-family reviewer through
   Kanban; do not perform final acceptance or merge.

## Acceptance

- All five tooling packages resolve to the verified latest stable versions;
  `@types/node` resolves to a stable 24.x version.
- Complete static job, fixture production build, and `cf:dry-run` exit zero.
- Both `bun audit --audit-level=moderate` results are reported.
- Sharing images render correctly; Playwright baseline differences are
  explicitly reported.
- The PR includes a version comparison and reviewable evidence.

## Initial setup and prerequisite check: 2026-10-01

- Latest fetched `origin/pre` is
  `b9650f063895c9eaf97ea91eb57c3882f89ce23c`; the task checkout started there.
- GSC_0038 is accepted, but its PR
  <https://github.com/jasonhnd/gitstarclub.com/pull/619> remains open with
  `mergedAt: null` and head
  `425dc0887a9d36e85a5a9f3034a9eb565b019b39`.
- `origin/pre:web/package.json` still declares Next 16.3.6 and OpenNext
  `^1.20.6`, rather than the prerequisite's Next 16.3.8 and OpenNext `^1.20.7`.
  Implementation is blocked until the prerequisite lands in `pre`, preserving
  the required serial dependency-upgrade order and avoiding lockfile overlap.
- Created `chore/593-tooling-updates` from the fetched `origin/pre`.
- The exact `AGENTS.md` bootstrap exited zero. Both official archives passed
  SHA-256 verification; Node reported v24.20.0 and Bun/bunx reported 1.3.14.
- In a clean environment, checked that `web` and `pipeline` contain no
  `.env*` files, then ran `node scripts/assert-runtime-versions.mjs` and
  `bun install --frozen-lockfile` in both directories. All exited zero;
  658 web packages and 35 pipeline packages installed. Neither lockfile changed.
- No dependency declarations have been changed. The full static job, builds,
  moderate audits, sharing-image checks, and Playwright comparisons are pending.

## Resumed implementation: 2026-10-01

PR #619 merged at 13:15:35 UTC as
`aa175a8f6ab7a9892a8c7f25f57f531c372733ba`. The unpublished plan commit was
rebased onto that latest `origin/pre`. Next 16.3.8 and OpenNext 1.20.7 are now
part of the baseline. Frozen installs and the verified bootstrap passed again.

The npm registry was rechecked after resuming: stable targets are Wrangler
4.145.0, PostCSS 8.5.28, sharp 0.35.5, Playwright 1.63.0, and the newest stable
Node 24 types, 24.19.0. The global Node types latest tag is 26.6.3; it is outside
this issue's allowed major line.

The lockfile also aligns the `playwright-core` peer used by axe with Playwright
1.63.0. Bun initially retained the 1.62.1 peer while nesting a 1.63.0 core for
the new test runner, which made the two E2E `Page` types incompatible. A targeted
core update followed by removal of Bun's temporary direct declaration keeps
only the necessary lockfile change; no new direct dependency or override is
introduced. A nonincremental typecheck passed on the aligned graph.

Capture a bounded local baseline before changing packages. The baseline uses
`pulse`, `rankings`, `categories`, `compare`, and `about`, English, both themes,
and all four viewports in the committed screenshot generator (40 screenshots).
The CI fixture intentionally supplies missing-data responses, so this comparison
covers static chrome and empty states rather than populated production data.
All browser network requests outside loopback are blocked. Sharing images are
checked separately, including a known repository card from checked-in fixtures.

The detached verification worktree and disposable logs are placed inside this
card's ignored web test-output directory to keep all work in the card
workspace. No live data store, platform API, or credentials are needed.
