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
- Adapt the existing local workerd test fixture to the Miniflare version
  brought in by Wrangler, preserving its conditional-write assertions.
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

## Baseline and compatibility

Started implementation from `origin/pre` at `aa175a8`, after PR #619 merged.
The npm registry was checked on 2026-10-01 for stable releases. Node types
24.19.0 are the latest stable 24.x types; the global latest 26.x line was excluded.

The Playwright core peer used by axe is aligned to 1.63.0 in the lockfile. Keeping
Bun's older 1.62.1 peer alongside the new nested core caused incompatible `Page`
types. No new direct dependency, override, type cast, or test assertion removal
is introduced. Wrangler's Miniflare update also removes the `type: "worker"`
configuration field; the existing local R2 fixture drops that field and updates
its workerd version comment while preserving all 19 conditional-write assertions.

## Completed verification

The complete code and test change was verified at
`9cbf3c724bbcd2de23e98271bc9b817e71265609` in a fresh detached worktree,
using the SHA-256-verified Node 24.20.0 and Bun 1.3.14 under `env -i` and
`bash --noprofile --norc`. Wrangler telemetry was disabled and its configuration
was isolated in an empty directory; the legacy home directory did not exist.

### Resolved version comparison

| Package | Before | After |
|---|---|---|
| `wrangler` | 4.133.0 | 4.145.0 |
| `postcss` | 8.5.23 | 8.5.28 |
| `sharp` | 0.35.4 | 0.35.5 |
| `@playwright/test` | 1.62.1 | 1.63.0 |
| `playwright` | 1.62.1 | 1.63.0 |
| `playwright-core` | 1.62.1 | 1.63.0 |
| `@types/node` | 24.13.3 | 24.19.0 |

Next 16.3.8, OpenNext 1.20.7, product dependencies, and all existing security
pins remain unchanged. Wrangler's required companion packages advance Miniflare
from 5.20260916.0-alpha to 5.20260930.0-alpha and workerd from 1.20260916.1 to
1.20260930.2. sharp's platform packages and libvips packages follow its patch
release. The primary updated lockfile integrity values match npm's registry.

### Commands and results

| Check | Result |
|---|---|
| Exact `AGENTS.md` bootstrap and runtime/CF gate assertions | Pass |
| Frozen web and pipeline installs; high-severity audits | Pass |
| Pipeline `bun run test` | 24 pass, 0 fail |
| Root `bun run lint:docs` | Pass |
| Web `bun run lint` | Pass; 14 warnings, 0 errors |
| Web `typecheck`, `typecheck:tests`, `typecheck:scripts` | Pass |
| `bun run validate:views -- scripts/fixtures/views` | Pass |
| `BLOB_BASE_URL=https://blob.example.com SEO_LIVE_BASE="" bun run test:cov` | 1409 pass, 49 skip, 0 fail; 171 files |
| LCOV coverage gate | Lines 86.43%, functions 86.95%; both above 80% |
| Fixture `bun run build` | Pass |
| Fixture `bun run cf:dry-run` | Pass with Wrangler 4.145.0; pre only; no deployment |
| Web `bun audit --audit-level=moderate` | Exit 0; no vulnerabilities found |
| Pipeline `bun audit --audit-level=moderate` | Exit 0; no vulnerabilities found |
| Verification lockfile comparison | Neither lockfile changed during frozen installs |
| Local R2 conditional-write test | Pass; all 19 assertions retained |

Both builds used the committed read-only HTTP fixture on loopback. No live-smoke
or release-gate opt-ins, real environment files, write credentials, or real data
stores were used. No CI workflow, Worker configuration, or deployment script was
edited. The screenshot/image comparison and cleanup details follow below.

### Sharing images and sharp

All four HTTP metadata-image routes discovered from the Next build manifest
return 200, `image/png`, and 1200x630. Route names with Next's generated suffixes
were used rather than guessed URLs. The stored-fixture known-repository and
unknown-repository routes also render correctly in an isolated Bun process:
only the known id reads the entity; external fetches are forbidden and the
original fetch is restored.

All six before/after PNGs are byte-identical. The known fixture remains 51,829
bytes and the unknown site card remains 56,781 bytes, matching the issue #585
committed images. sharp 0.35.5 with libvips 8.18.7 decodes each card and resizes
it to 600x315 PNG successfully; the baseline used sharp 0.35.4/libvips 8.18.6.

### Playwright baselines

Playwright advances from 1.62.1 to 1.63.0; bundled Chromium advances from
151.0.7922.34 (revision 1234) to 153.0.8010.12 (revision 1243). Both local
capture runs pass all 40 cases. Of the 40 decoded-pixel comparisons, 38 are
identical. Two Rankings screenshots differ by 129 pixels (1440x1100 light,
0.008144%) and 56 pixels (768x1024 dark, 0.007121%). Differences are confined
to header edges, with maximum channel deltas of 13 and 12 out of 255. Visual
inspection finds no content or layout change. Browser rasterization is a
possible explanation; the exact cause was not isolated. No existing baselines
are replaced. See [before/after evidence](593-tooling-screenshots/README.md) and
[machine-readable results](593-tooling-verification.json).

### Limits and cleanup

The screenshot fixture intentionally returns missing data. Browser coverage is
English static chrome and empty states across five routes, four viewports, and
both themes; populated datasets, other locales, and a live deployment were not
browser-tested. No UI redesign or production code change is intended.

The detached verification worktree was removed successfully. The final
verification-record commit receives a fresh static/build/audit run as well;
its exact result and head are recorded in the Kanban handoff. Final acceptance
and merging remain with the reviewer and project owner.
