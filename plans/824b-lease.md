# Card 824-B: recovery generation, pointer commit and shared lease

## Goal and scope

Add a self-contained `web/scripts/repair-publish-commit.ts` beside the #786
builder, with fake `cf` runner tests under `web/lib/`. Capture the explicitly approved frozen
fallback views and 33 flat canonical objects into a separate recovery generation,
verify both phases with SHA-256, and use `commitBootstrapGeneration` to switch
only `bootstrap/latest.json` under `ops/workflows/active.json`.

Out of scope: publisher core, CLI, target confirmation and identity guards,
real bucket access, credentials, deployment, and branch changes. Integration
must supply the guarded target and injected runner. No default runner is added.

## Steps and acceptance

1. Replace prefix enumeration with exact-key checks and manifest-driven reads;
   require an explicit frozen-base inventory file and the fixed 33-key canonical
   source. Implement checked JSON reads, create-only recovery staging and shared
   lease ownership checks; reuse the existing manifest and pointer helpers.
2. Test acquisition, recovery sealing, pointer commit and release ordering;
   refuse active leases, incomplete recovery, changed source pointers, failed
   commands, mismatched bytes and ownership loss. Confirm the recovery edge
   is in `previous_generation`, the existing pointer schema's rollback field.
3. Run the requested full pipeline and web coverage suites, plus static checks,
   and commit on the current branch. Keep all temporary files in
   `.kanban-work/824b/` to honor this card's workspace constraint; do not create
   a detached repository copy or switch branches.

## Lease limitation and remaining risk

The importer uses atomic conditional writes with a fencing token (an increasing
ownership number). `cf r2 objects put` exposes no conditional write. This card
uses read-verify-write followed by readback, a unique owner token, the importer's
lease record fields and ten-minute expiry, periodic renewal, and ownership checks
immediately before writes. Release updates only a record still owned by this
invocation; it never deletes another owner's record.

These checks are advisory, not atomic mutual exclusion. Two contenders can read
the same old record, each write and observe its own token, and overwrite one
another between checks. The same race affects create-only checks and pointer
writes. Readback detects many conflicts but cannot undo an overwrite or prove
exclusion. A human-run single-writer maintenance window remains required; an
atomic production-side conditional writer is needed to remove this risk. This
module must not be represented as providing the importer's atomic guarantees.
The preview Worker `gitstarclub-web-pre` (mode `pre`) declares three cron
triggers (scheduled tasks): `0 3 * * *`, `0 4 * * SUN`, and `0 6 * * SUN`.
They use the preview Worker and preview bucket. Production `hostWorker`
declares no scheduled triggers in source, but the root README still marks the
live production trigger unverified. Source does not prove the live production
scheduler is off. The human single-writer window is an operational requirement.
No real bucket operations are authorized by this card.

The original output-format claim was incorrect for list pagination. Pinned
`cf@1.0.0-beta.18` prints only an array of object records for `objects list`;
cursor and truncation metadata are discarded. It cannot prove prefix completeness.
Never enumerate a prefix. The manifests in both generation phases and fixed
canonical layout supply keys. Existence checks list the full key as prefix:
exact match means present; missing exact match on a page shorter than 1,000 means
absent; a full page without that key is ambiguous and refuses. Every read,
including lease and pointer reads, uses this check before exact-key `get`, whose
stdout is the raw body. Every non-zero get exit is a hard failure, including a
key disappearing after the listing. No stderr parsing determines absence.
The runner must apply the supplied child environment, including
`CF_DELEGATION=1`.

Recovery sources are exactly `views/refresh-2026-09-13T06-00-16-398Z/`, using a
reviewed explicit local inventory file, and `canonical/v2/meta.json` plus
`canonical/v2/repos/0.json` through `31.json`. No whitelist, overlays, or pointer-
selected sources are copied. Source sizes and SHA-256 digests are checked after
create-only staging. Rollback points bootstrap/latest.json at recovery and never
changes VIEWS_VERSION_FALLBACK. See docs/OPS.md for the inventory format.
The string runner supports UTF-8 JSON only; size/hash checks reject lossy copies,
while legitimate U+FFFD is allowed. Binary snapshots remain unsupported.

## Round 1 acceptance

- Real cf list arrays and raw get bodies are exercised; no cursor adapter exists.
- Missing/incomplete sources, ambiguous absence, manifest corruption and lease
  contention refuse without switching the pointer.
- Corrupt recovery after seal with an older pointer present refuses unchanged.
- Acquisition failure after put releases a still-owned lease; cleanup preserves
  the primary error. Post-commit cleanup failures report that the pointer moved.
- Long operations renew the lease, and failed renewals are immediately retryable.
- Run the complete requested pipeline/web suites and available static/build
  checks on the current branch, with artifacts under `.kanban-work/824b-r1/`.
  The explicit no-copy instruction overrides the detached-clone procedure.

## Round 2 plan and acceptance

1. Apply part A's full-key existence algorithm to all reads, including the
   lease and both pointers, preserving JSON byte-size validation. Never infer
   absence from CLI errors. Avoid recursive renewal during lease listings.
2. Use real pinned cf output shapes in fake-runner tests: list arrays, raw
   bodies, and boxed errors with line prefixes and ANSI colours. Cover the idle
   layout with all three control objects absent, full-page ambiguity, a 500
   mentioning 404, and deletion between list and get. Test interval renewal
   while a non-lease command is pending and distinguish JSON size errors.
3. Correct scheduler documentation and run full pipeline/web coverage suites,
   static checks and local fixture builds on the current branch. Keep all
   artifacts in `.kanban-work/824b-r2/`; no repository copies, branch switches,
   credentials, bucket access, platform commands, deployments or pushes.

Scope remains this library, its local tests and operations documentation. CLI
integration, conditional writes and live scheduler verification remain out of
scope. Acceptance requires failure before publication for unknown reads or
races, successful idle-layout sealing, and preserved advisory lease ownership.

## Round 2 verification results

Source commit under test: `54fb136` on `ib/gsc-824b-r2`. Verification used
SHA-256-verified Node v24.20.0 and Bun 1.4.2 archives under `env -i` in the
current repository. The no-copy/current-branch instruction overrides the
detached-checkout recipe. Temporary files, dependency caches and logs stayed
under `.kanban-work/824b-r2/`, instead of the suggested external `$HOME/ktmp`.
No owner environment files, live-test opt-ins, credentials, real bucket access,
platform commands, deployments or pushes were used. Frozen installs at root,
pipeline and web produced no lockfile changes.

Passed:

- Full pipeline suite: `bun test --timeout 30000`, 208 passed, zero failed.
- Full web suite: `BLOB_BASE_URL=https://blob.example.com SEO_LIVE_BASE= bun run test:cov`,
  2,383 passed, 49 skipped, zero failed, across 222 files. The coverage gate
  measured 90.43% lines and 90.98% functions. Bun's printed table separately
  reported 92.03% lines and 89.82% functions; the repair module reported
  100% lines and 98.39% functions.
- All 33 repair tests passed in the full suite. Every get is preceded by a
  full-key list. The idle layout with all three control objects absent seals
  and commits without fetching absent controls, including short listings with
  prefix siblings. Controls refuse ambiguous full pages and accept exact
  matches on full pages. Boxed cf errors cover errors-array and fallback
  renderers, plain and ANSI-coloured text, 404 and 500 statuses, and bodies
  mentioning 404. Deletion between list and get fails for the lease, both
  pointers and a frozen source. No failed read publishes a pointer.
- The committed timer test holds a non-lease get pending, advances the injected
  clock, invokes its captured 30-second interval callback, and observes renewal
  with the same owner and fencing token before unblocking the get. Lease
  commands do not start recursive timers. Size and non-JSON errors are distinct.
- Web lint: zero errors, 14 existing warnings. All three typechecks, generated
  view validation, web dependency audit, graph validation and CF CI guards.
- Markdown fences/metadata, environment inventory, maintained facts and English
  checks. Documentation contract tests: 49 passed, one baseline failure below.
- Local production and pre builds using only the GET/HEAD fixture, followed by
  matching host validation: 234 routes and 467 artifacts per mode, with local
  fonts, indexing and bindings validated.
- `git diff --check`; current branch preserved; no lockfile changes.

The full static job remains blocked by unrelated baseline failures:

- Pipeline dependency audit: high-severity findings in `undici@6.28.1` and
  transitive `zod@4.1.11`.
- `lint:docs`: eight unresolved references to the missing scripts `perf-local.ts`
  and `perf-metrics.ts` across `plans/760-astro-preview-deploy-guard.md`,
  `plans/779-footer-date-rework.md`, `plans/781-public-refresh-releases.md`, and
  `plans/astro-accept-1-baseline.md`. These files and the pipeline lockfile are
  unchanged from starting commit `5a8d3ee`. The historical missing-frontmatter
  blocker recorded for round 1 no longer occurs on this branch.

Logs: `bootstrap.log`, `install.log`, `static.log`, `verify-rest.log`, `docs.log`
and `docs-details.log` in the card directory. The final documentation-only
commit records results and clarifies that preview rollback is not evidence of
live production scheduler state; tested source code and tests are unchanged.

## Round 1 verification results

Source commit under test: `6790aad` on `ib/gsc-824b-r1`. All commands ran in
this repository under `env -i` with verified Node v24.20.0 and Bun 1.4.2
archives. The explicit current-branch/no-copy instructions override the detached
verification clone recipe. `TMPDIR`, `KANBAN_TMP`, dependency caches, logs and
fixture output were kept in `.kanban-work/824b-r1/`, inside the repository,
rather than the suggested external `$HOME/ktmp`. No environment files, live-test
opt-ins, credentials, bucket access, platform commands, deploys or pushes were
used. The frozen installs produced no lockfile changes.

Passed:

- Full pipeline suite: `bun test --timeout 30000`, 208 passed, zero failed.
- Full web suite: `BLOB_BASE_URL=https://blob.example.com SEO_LIVE_BASE= bun run test:cov`,
  2,222 passed, 49 skipped, zero failed. Coverage gate: 90.23% lines and 90.89%
  functions. The repair module reported 99.61% lines and 98.36% functions.
- All 28 repair publication tests use raw get bodies and list arrays. They cover
  ambiguous full pages, exact matches on full pages, malformed Workers-style
  listing envelopes, explicit frozen inventory fingerprints, all 33 canonical
  keys, older-pointer recovery corruption, acquisition cleanup, primary-error
  preservation, uncertain pointer readback and post-commit release failure.
- A separate local fake-runner check delayed an exact-key get for 31 seconds;
  the interval heartbeat renewed the same owner and fencing token while that
  command was blocked. It used no network or bucket operations.
- Web lint: zero errors, 14 existing warnings. All three typechecks, generated
  view fixture validation, dependency graph validation and CF CI guards passed.
- Web dependency audit passed. Documentation contract tests: 44 passed; the
  reference, environment inventory, maintained-fact and English checks passed.
- Local production and pre builds, plus matching host validation: 234 routes
  and 467 artifacts each, including indexing, local fonts and bindings checks.
- `git diff --check`; current branch and working tree remained intact.

The full static job remains blocked by the same unrelated baseline failures:
`pipeline` dependency audit reports high-severity findings in `undici@6.28.1`
and transitive `zod@4.1.11`; `lint:docs` rejects the missing metadata frontmatter
in `docs/analysis/743-preview-empty-monthly.md`. The remaining checks were run
separately without changing those dependencies or that document.
Logs: `bootstrap.log`, `static.log`, `verify-rest.log`, `docs.log`, and
`heartbeat-check.log` under the card directory. This result-recording change
only updates this plan; tested source code is unchanged.

## Original implementation verification results (historical)

Implementation commit: `fe6e580`. Verified in the current checkout on
`ib/gsc-824b`, following the explicit card prohibition on copying the repository
or switching branches. Bootstrap archives passed SHA-256 checks; the full run
used Node v24.20.0 and Bun 1.4.2 under `env -i`, without live-test opt-ins or
owner environment files. All temporary files and logs stayed under
`.kanban-work/824b/`. No real bucket operations, deployment or push occurred.

Passed:

- Frozen installs at the root, pipeline and web; no lockfile changes.
- `cd pipeline && bun test --timeout 30000`: 206 passed, zero failed.
- `cd web && BLOB_BASE_URL=https://blob.example.com SEO_LIVE_BASE= bun run test:cov`:
  2,210 passed, 49 skipped, zero failed. The coverage gate passed with 90.20%
  lines and 90.87% functions; the new module reported 100% lines and functions.
- All 16 new fake-runner tests passed, including pointer recovery metadata,
  publication order, incomplete recovery and mid-verification ownership loss.
- Web lint (14 existing warnings, zero errors), all three typechecks, generated
  view fixture validation, dependency graph validation and CF CI guard checks.
- Documentation contract tests: 44 passed; the reference, environment inventory,
  maintained-fact and English prose checks passed.
- Local production and pre Vite builds, followed by matching host validation:
  234 routes and 467 artifacts in each mode; indexing and local fonts validated.
- `git diff --check`.

The complete static job is **not green** because of two existing blockers:

- `cd pipeline && bun run audit:deps`: high-severity findings in pinned
  `undici@6.28.1` and transitive `zod@4.1.11`.
- `bun run lint:docs`: the markdown frontmatter gate rejects existing
  `docs/analysis/743-preview-empty-monthly.md`, which already lacked metadata
  before this card. The remaining documentation checks passed separately.

The remaining checks were run separately after each blocker; dependencies and
the unrelated document were left unchanged. Logs are `verify.log` (audit),
`verify-rest.log` (pipeline and documentation frontmatter), `verify-final.log`
(web static checks, coverage and both builds), and `doc-tests.log` under the
card directory. The second commit records these results only.
