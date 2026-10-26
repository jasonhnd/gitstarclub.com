# Issue 804: release detail pages

## Goal

Render a retained public release at `/releases/<id>` in all seven locales.

## Scope

- Read and validate the shared `views/releases.json` contract without a version prefix.
- Show publication time, previous release link, repository counts and available layer dates.
- Link existing public metadata, publication pointers and matching health records.
- Cover normal, missing and empty histories with unit and built Worker tests.
- Capture English and Japanese screenshots at widths 1440 and 390.

## Out of scope

Deployment, secrets, production operations, release writer changes, and branch changes.
The owner specifies the existing #781 base and eventual PR target
`feat/trusted-archive-v01`; do not retarget to `pre` for this card.

## Acceptance

All seven locales render translated text; unknown or unretained ids return 404.
Run the requested Astro preview build, Worker checks and full Astro suite,
plus relevant typechecking and the full web suite. Keep temporary artifacts in
`.kanban-work/804` and verify in place because repository copies are prohibited.

## Steps

1. Add release reader, localized copy and Astro routes.
2. Add fixture coverage and documentation.
3. Commit implementation, run verification and capture screenshots.
4. Record verification and commit the results.

## Verification results

Implementation and screenshot commit: `4607250b4f404283b93d39d082e25ab9394fdebf`.
Verification ran in place with Node 24.20.0, Bun 1.4.2, clean environments,
card-local temporary storage and local fixtures. Official Node and Bun archives
passed SHA-256 verification. No environment files or live-test opt-ins were used.

| Check | Result |
| --- | --- |
| Requested Astro preview build, Worker checks and full tests | PASS: preview build; 10 Worker checks; 354 tests. |
| Astro typecheck | PASS: zero errors/warnings; 15 existing diagnostic hints. |
| Astro preview host validation | PASS, including 22 local aggregate-import guard cases. |
| Full web coverage suite | PASS: 2,199 passed, 49 skipped, zero failures; 90.08% lines and 90.73% functions. |
| Web lint, all three typechecks and view validation | PASS. |
| Web dependency audit and host graph | PASS. |
| Runtime version and CI gate assertions | PASS. |
| Pipeline tests | PASS: 205 tests. |
| Documentation lint | Existing failure: six unresolved path references in the unchanged plans for issues 760, 781 and the Astro baseline. They refer to outdated locations of the Astro performance scripts. |
| Pipeline dependency audit | Existing failure: transitive `undici@6.28.1` and `zod@4.1.11` advisories. No lockfile or dependency changes made. |

The original branch captured before/after screenshots, which this integration
intentionally omits along with generated artifacts. All eight original captures had no
horizontal document overflow. The browser comparison and performance harnesses
now allocate a fresh temporary Chromium profile on every launch, as required by
the owner. No Edge browser or reserved debugging port was used.

GitHub CLI has no authentication in this environment, so opening a pull request
is unavailable. The prepared description is in the card-local scratch directory;
the intended target remains `feat/trusted-archive-v01` after #781 merges.
The current branch remains `ib/gsc-804`. No branch switch, repository copy, merge,
deployment, production operation, workflow edit or secret change was performed.
