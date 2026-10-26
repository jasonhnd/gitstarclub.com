---
owner: product
status: complete
last_reviewed: 2026-10-26
source_of_truth_for:
  - Issue 780 About this data component
---

# Issue 780: About this data

## Goal

Provide an accessible, reusable Astro disclosure describing the published data used by a page, including coverage, methodology, citation and release identity.

## Scope

- Add a server-rendered component and a small progressive clipboard enhancement.
- Accept the published metadata, its matching publication identity, page title, canonical URL and explicit data layer from the caller.
- Add all UI copy to the existing seven locale dictionaries and stable methodology anchors on About.
- Add fixture-backed English/Japanese render tests and isolated browser verification with 1440/390 screenshots and a seven-locale copy table.
- Run the requested Astro build, Worker and unit suites, plus appropriate shared-web static checks. Keep all temporary output under `.kanban-work/780` in the current repository; do not clone or change branches.

## Out of scope

Page placement, release pages, data publication, deployment, platform configuration, unrelated pages, main-branch promotion and merging.

## Acceptance

- The native keyboard-operable disclosure shows all five requested facts using supplied published values.
- Current totals, period gains and history curve use matching localized method links.
- Citation is selectable without scripting; Copy handles success, missing API and permission failure without unhandled errors.
- Seven locales have complete copy; English and Japanese fixture renders verify dynamic metadata, citation and links.
- Desktop/mobile evidence shows expanded and collapsed states without overflow.

## Steps

1. Record this plan.
2. Implement component, copy, stable About anchors and usage documentation.
3. Add render/browser tests and capture acceptance artifacts.
4. Run full verification, record results and commit completed work.

## Delivered

- Implemented `astro/src/components/AboutThisData.astro` with static content and a small clipboard enhancement; no product page mounts it.
- Added all seven locale dictionaries, three stable localized About methodology anchors and component usage documentation.
- Added fixture render tests and a standalone browser fixture. Acceptance output lives in `.kanban-work/780/about-data-evidence/`, including the seven-locale copy table and English/Japanese before, collapsed and expanded screenshots at 1440/390 pixels.

## Verification results

Used checksum-verified Node 24.20.0 and Bun 1.4.2, isolated environment variables and card-local temporary paths. Verification ran in the current repository because the owner forbids copying the repository or changing branches. No owner environment files were loaded. Build output is a local preview artifact only.

- Requested Astro preview build, Worker suite and unit suite passed: 7 Worker tests and 353 unit tests.
- Astro type checking passed with no errors.
- Browser acceptance passed keyboard operation, clipboard success and missing/denied clipboard fallback, multiple instances, scripting disabled, no browser errors, no mobile overflow and automated accessibility checks. Used only Playwright Chromium with fresh temporary profiles.
- Shared web lint, three typechecks, dependency audit, graph validation, runtime/host gate assertions and fixture validation passed.
- Full shared web coverage suite passed: 2,172 tests passed, 49 skipped, zero failures; 90.10% line and 90.70% function coverage.
- Pipeline suite passed all 205 tests. Its dependency audit remains blocked by existing high-severity transitive undici 6.28.1 and zod 4.1.11 advisories; no lockfiles changed.
- Documentation validation remains blocked by pre-existing unresolved performance-script references in `plans/760-astro-preview-deploy-guard.md` and `plans/astro-accept-1-baseline.md`.
- `git diff --check` passed.

The initial Worker browser attempt could not find Chromium under the isolated cache path. The complete Worker suite passed after selecting the already-installed Playwright browser directory. A pull-request description with `Closes #780`, verification results and evidence paths is prepared under the card directory. Owner visual approval and publication/merge remain separate delivery steps.
