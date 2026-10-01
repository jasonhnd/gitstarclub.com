# Remove unused UI and i18n compatibility code (#608)

## Goal

Remove code-health findings A01, A03, L01, and L02. Live pages, the language-switch contract, and canonical locale helpers stay as they are. No reader-visible change.

## Scope

- Delete unused explore components after a repo-wide consumer check: CardLink, ContentGrid, SectionHeader, and TwoColumnLayout.
- Retire the unused answer-capsule base and its test. Move the assertions that still describe the live component into `web/lib/answer-capsule.test.tsx`.
- Delete the unused client dictionary provider, the cookie-based dictionary helper, and the unused pulse meta constants. Update the client test header so it no longer points at that provider.
- Delete only the unused aliases localeToHreflang, localeToBcp47, localeToOpenGraphLocale, and classifyPath. Keep `toHreflang`, `toBcp47Locale`, `toOpenGraphLocale`, and `classifyRoute` in `web/lib/i18n/routing.ts`.
- Update `docs/FRONTEND.md`, `docs/I18N.md`, `docs/SEO.md`, and `docs/CHANGELOG.md` so they no longer name the deleted modules. The doc reference gate requires every backticked repository path to exist.

## Out of scope

- `AnswerCapsule` markup, labels, and call sites.
- `/api/lang`, `LanguageSwitcher`, route dictionaries, and `web/lib/i18n/client.tsx`.
- CSP, the `Star` component, and `resolveAvailableRankPeriods`.
- CI workflows, `.delivery.yml`, Worker wrangler config, deploys, and real buckets.

## Acceptance

- No tracked JS/TS importer remains for the deleted symbols. `classifyPathFamily` in the geo log report is a different function and stays.
- `AnswerCapsule` still renders `data-testid="answer-capsule"`, the data-as-of block, and the source block. The base-only missing-date, missing-source, supporting-facts, and source-link behavior is not copied onto the live component.
- Canonical locale helpers and existing routing tests stay green. A new assertion fails if any of the four aliases is exported again.
- The static job and the fixture production build from `AGENTS.md` pass in a fresh detached worktree. `bun.lock` is not committed.
