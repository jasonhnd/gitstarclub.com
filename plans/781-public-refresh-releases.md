# Issue 781: public managed-refresh releases

## Goal

Publish one public release record for every committed managed refresh, shared by
the web and Astro hosts.

## Scope

- Define a versioned Zod contract at `web/lib/contracts/releases.ts`.
- Write `views/releases.json` after the managed publication pointer commits,
  preserving records by run id and retaining the newest 100 records.
- Include the original publication timestamp and previous version, tracked and
  skipped repository counts, and all layer dates available in version metadata.
- Aggregate completed metadata buckets without counting retry hops twice.
- Document retention, retry and failure semantics in `docs/DATA-CONTRACTS.md`.
- Test successful append, duplicate retries, failed publication, skipped counts,
  bounded retention, and shared Astro contract availability.

## Out of scope

UI changes, new pages, deployment, platform commands, production configuration,
secrets, branch changes, and remote refreshes. Tech performs a preview refresh
after merge to compare the published record with bucket contents.

## Acceptance

- Failed pointer publication leaves the release history unchanged.
- Same-run retries preserve the original record without duplicates.
- Missing or invalid release inputs fail explicitly instead of inventing counts.
- Full web coverage suite and Astro preview build, worker tests, and tests pass.
- Run the repository static checks and local build validation where possible.

## Workspace and verification

Keep the current branch and repository in `~/w` as instructed for this card.
Use `.kanban-work/781` for `KANBAN_TMP`, `TMPDIR`, caches and logs. Run verification
in place: the owner's current instruction prohibits copying the repository or
checking out another branch, overriding the older detached-clone instructions.
Use a clean environment without live-test opt-ins or owner environment files.

## Progress

- [x] Inspect publication, metadata, shared host boundaries, and data contracts.
- [x] Implement release contract, publication integration, and tests.
- [x] Run verification and record results.

## Verification results

Implementation commit tested: `bc2331a034c1816c46ef929a225905dcb3d364b2`.
Node 24.20.0 and Bun 1.4.2 archives and binaries were reverified before testing.
All commands ran in place with a clean environment and card-local temporary
storage; no owner environment files or live-test opt-ins were present.

| Check | Result |
| --- | --- |
| `cd web && bun run test:cov` | PASS: 2,199 passed, 49 intentionally skipped, zero failures across 213 files. Coverage gate: 90.08% lines, 90.73% functions. New release contract and writer: 100% lines/functions. |
| `cd astro && bun run build:pre` | PASS against a local read-only fixture. |
| `cd astro && bun run test:worker -- --timeout 30000` | PASS: 7 tests; bundled Chromium with a fresh card-local profile. |
| `cd astro && bun run test` | PASS: 349 tests across 23 files. |
| Astro typecheck and preview host validation | PASS: no type errors or warnings; 14 pre-existing diagnostic hints. |
| Web lint, all three typechecks, fixture validation, dependency audit and host graph | PASS. |
| Runtime version and CI gate assertions | PASS. No workflow or deployment configuration changed. |
| `cd pipeline && bun run test -- --timeout 30000` | PASS: 205 tests across 11 files. |
| Web local production and preview builds, each followed by matching host validation | PASS: 234 core routes and 467 artifacts per mode, local fixtures only. |
| `bun run lint:docs` | BLOCKED at the recorded time by four existing unresolved references to [performance runner](../astro/scripts/perf-local.ts) and [performance metrics](../astro/scripts/perf-metrics.ts) in `plans/760-astro-preview-deploy-guard.md` and `plans/astro-accept-1-baseline.md`. Those files were unchanged by that card. |
| Pipeline dependency audit | BLOCKED by existing high-severity advisories for transitive `undici@6.28.1` and `zod@4.1.11`. No dependency or lockfile changes belong to this issue. |

Publication's first invocation now uses 60 storage operations instead of 23;
later notification invocations remain at 452 and 455, within the existing
500-operation test budget. Both hosts' expectations were updated. The full
metadata-resume fixture has an explicit 30-second timeout so coverage overhead
does not trigger Bun's default five-second limit. No production behavior or
verification assertions were weakened.

## Tech acceptance after merge

Run one full managed refresh in preview. Read the public
`views/releases.json` from the same bucket as `views/latest.json`, then compare
the newest record's id, publication timestamp and previous version against the
pointer and publication intent; compare its tracked count and layer dates
against versioned metadata, and its skipped count against all completed bucket
ledgers. The first new publish creates history; it does not backfill old runs.

No deployment, platform CLI, remote refresh, production operation, branch
switch, repository copy, or production configuration change was performed.

## Rework round 1

### Goal and scope

Address the review of issue #781 on the current branch. Read the release's
version metadata and all 32 metadata ledgers directly from the write store's
origin, keeping missing, malformed, incomplete or mismatched input as a hard
failure before publication. Reject an append if retention would remove its new
id. Preserve the `releases` step when ownership is lost inside the append.

### Out of scope

All other publication behavior, the advisory cursor skipped count, UI, generated
files, screenshots, dependencies, deployment and production configuration.
Do not copy the repository, switch branches, push, or merge.

### Acceptance and verification

- Origin inputs work despite stale or unavailable public reads; no fallback can
  conceal missing or incomplete origin ledgers.
- An excluded new release fails before writing history.
- An append lease loss stays non-retryable and records `failed_step: "releases"`.
- Run the complete web coverage suite, repository static checks, local builds,
  and shared Astro tests using a clean environment and card-local storage at
  `.kanban-work/781-r1`. Record failures without changing unrelated files.

### Rework results

Implementation commit tested: `b01f971791437a796bd64a4e298114afde190c1f`.
Node 24.20.0 and Bun 1.4.2 archives passed checksum and version verification.
All checks ran in place on `ib/gsc-781-r1` with a clean environment, no owner
environment files or live-test opt-ins, and card-local caches and logs.

- Release preparation now uses the write store's origin for metadata and every
  bucket ledger. Existing completeness and schema checks remain hard failures.
- An append that would evict its own new id fails before any history write,
  including when equal timestamps exclude it by the id tie-breaker.
- A lease lost inside the append preserves the `releases` step, the committed
  version and the non-retryable lease error type. Runtime coverage confirms the
  failure record and alert, no retry, and no writes over the successor lease.
- The advisory skipped-count cursor and publication ordering are unchanged.

| Check | Result |
| --- | --- |
| Focused release, publish and lease-loss tests | PASS: 72 tests. |
| Full web coverage suite | PASS: 2,204 passed, 49 skipped, zero failures across 213 files. Lines 90.08%; functions 90.74%. Release contract and writer: 100% lines/functions. |
| Web lint, three typechecks, view fixture and host graph | PASS. |
| Runtime and CI gate assertions; web dependency audit | PASS. |
| Pipeline test suite | PASS: 205 tests across 11 files. |
| Web production and preview builds with matching host validation | PASS: 234 routes and 467 artifacts per mode; local read-only fixture. |
| Astro test suite | PASS: 349 tests across 23 files. |
| Astro preview build, host validation, graph and typecheck | PASS. |
| Astro Worker suite | PASS: 7 tests across 4 files; bundled Chromium with a new card-local temporary profile. |
| Documentation lint | BLOCKED: six pre-existing unresolved performance-script references across the existing plans, including the original verification paragraph in this plan. |
| Pipeline dependency audit | BLOCKED: existing high-severity advisories for transitive `undici@6.28.1` and `zod@4.1.11`. Lockfiles and dependencies are unchanged. |

The initial test typecheck overlapped the web build, whose generated Cloudflare
type declarations introduced unrelated global type conflicts. Moving only those
generated declarations to card-local storage outside the typecheck input and
rerunning the unchanged test typecheck passed. No source, test assertions or
compiler configuration was changed to resolve that verification ordering issue.

No repository copy, branch switch, push, merge, deployment, production call or
configuration edit was performed. No screenshots or generated files were committed.
