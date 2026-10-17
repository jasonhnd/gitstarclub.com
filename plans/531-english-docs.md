# Issue #531 — English-only docs, plans, and agent files

## Goal

Translate tracked Chinese in docs, plans, agent instructions, and developer-facing comments to English. Behavior stays the same.

## Scope

- Faithful translation of Han text in docs, plans, `.cursor/agents/`, `AGENTS.md`, `.grok/rules/`, `.delivery.yml`, `.env.example`, and code comments / developer log strings.
- English-only rule in `AGENTS.md`.
- A CJK scan in `scripts/check-docs.mjs` for `docs/`, `plans/`, `AGENTS.md`, `.cursor/`, and `.grok/`, with an allowlist for product locale paths.

## Out of scope

- Product locale copy: `web/lib/i18n/dictionaries/*`, `web/lib/i18n/locales.ts`, `web/app/_localized/*`, `web/lib/format.ts`, `web/lib/narrative.ts`, `web/lib/shareable-snippets.ts`.
- Tests that assert localized output (`*.test.ts`, `*.test.tsx`, `web/e2e/*.spec.ts`).
- Live wrangler deploy, versions upload, and schedule / DNS / secret changes.

## Acceptance

- The issue's Han-ideograph file grep lists only the locale and localized-test paths above.
- `bun run lint:docs` passes.
- `node scripts/assert-cf-ci-gates.mjs` passes.
- `cd web && SEO_LIVE_BASE='' RUN_LIVE_SMOKE=0 bun run test` passes.
- No behavior change.
