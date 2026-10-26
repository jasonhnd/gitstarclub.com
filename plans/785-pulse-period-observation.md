# Issue #785: Pulse period observation date

## Goal
Show a localized observation-start notice under weekly and monthly Pulse lists and their matching ranking pages when the first published observation inside the period is after its first day.

## Scope
- Use `current_month.daily_totals` for the open month and overlapping weeks.
- Use the matching heatmap cells for older months; omit older weeks without a daily series.
- Ignore repository admission dates and the gross/net seam when deciding coverage.
- Add localized copy in all seven supported locales.
- Cover partial series, series beginning on the first day, full later periods with newcomer admissions, and null repository baselines in helper and rendered-page tests.
- Capture requested English and Japanese desktop/mobile screenshots.

## Out of scope
- Changes to data publication, ranking calculations, other pages, deployment, and Cloudflare configuration.

## Acceptance
- Notice appears only for partially observed weekly/monthly periods and uses the published start date.
- All seven locales render the notice.
- Requested build and test command passes; screenshots are recorded for 1440px and 390px in English and Japanese.

## Rework round 1
- Stay on the existing issue branch and work only inside this repository.
- Verify in place with a clean environment: the owner forbids copying the repository or switching branches, so the detached-clone verification instruction does not apply to this card.
- Keep caches, logs, browser profiles, and screenshots in `.kanban-work/785-r1/`; do not commit generated files.
- Capture before/after views at 1440px and 390px in English and Japanese with Playwright Chromium and a fresh profile.

## Reapply onto the current archive branch
- Apply the three reviewed commits and squash them into one commit without changing branches.
- Preserve the existing About this data placements, release IDs, page identity citations, and unavailable-year handling.
- Keep the final coverage notices below their weekly/monthly lists and complete ranking sections.
- Run the owner's build-first verification sequence in place; do not deploy or commit generated output.
