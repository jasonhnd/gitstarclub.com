# Remove unused UI and i18n compatibility code (#608)

## Goal

Remove code-health findings A01, A03, L01, and L02. Live pages, the language-switch contract, and canonical locale helpers stay as they are. No reader-visible change.

## Scope

- Delete unused explore components after a repo-wide consumer check: `CardLink`, `ContentGrid`, `SectionHeader`, `TwoColumnLayout`.
- Retire `AnswerCapsuleBase` and `web/lib/answer-capsule-base.test.tsx`. Move the assertions that still describe `AnswerCapsule` into `web/lib/answer-capsule.test.tsx`.
- Delete `web/lib/i18n/client-runtime.tsx`, `web/lib/i18n/server.ts`, and `web/lib/site-copy.ts` after the same consumer check. Update the `client.test.ts` header so it no longer points at the deleted runtime.
- Delete only the unused aliases `localeToHreflang`, `localeToBcp47`, `localeToOpenGraphLocale`, and `classifyPath`. Keep `toHreflang`, `toBcp47Locale`, `toOpenGraphLocale`, and `classifyRoute`.

## Out of scope

- `AnswerCapsule` markup, labels, and call sites.
- `/api/lang`, `LanguageSwitcher`, route dictionaries, and `web/lib/i18n/client.tsx`.
- `docs/FRONTEND.md`, `docs/I18N.md`, `docs/SEO.md`, and `docs/CHANGELOG.md`. Those files still name the deleted modules. Issue #608's file list excludes them so this pull request does not collide with other cards. The descriptions were already stale for `site-copy.ts`: pulse metadata comes from `getDictionary` in `web/app/_localized/pulse.tsx`.
- CSP, the `Star` component, and `resolveAvailableRankPeriods`.
- CI workflows, `.delivery.yml`, Worker wrangler config, deploys, and real buckets.

## Acceptance

- No tracked JS/TS importer remains for the deleted symbols. `classifyPathFamily` in the geo log report is a different function and stays.
- `AnswerCapsule` still renders `data-testid="answer-capsule"`, the data-as-of block, and the source block. The base-only missing-date, missing-source, supporting-facts, and source-link behavior is not copied onto the live component.
- Canonical locale helpers and existing routing tests stay green. A new assertion fails if any of the four aliases is exported again.
- The static job and the fixture production build from `AGENTS.md` pass in a fresh detached worktree. `bun.lock` is not committed.
