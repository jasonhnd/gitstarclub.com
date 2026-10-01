# Plan: docs set B for issue #576

## Goal

Make the current docs describe Cloudflare Workers hosting, public preview, and the transitional Blob store. Move the superseded phase docs out of the live index. Do not overturn the #574 rollback and acceptance text.

## Scope

- Current docs: README, web/README, docs/README, OPS, DEVELOPMENT, ARCHITECTURE, REQUIREMENTS, ROADMAP, WORKFLOW, SEO, API, CODEBASE, GEO, DATA-CONTRACTS, geo/ai-log-reporting, R2-CUTOVER, AGENTS (the one hosting sentence that would otherwise stay false), CHANGELOG link targets plus one unreleased note.
- Move `docs/CF-MIGRATION-P1.md`, `docs/CF-MIGRATION-P2.md`, `docs/CF-MIGRATION-P3.md`, and `docs/R2-MIGRATION-P0.md` to `docs/archive/` with a one-line superseded banner. Update links and the docs index.
- Findings in scope: A01, A02, A03, A04, A05, A06, A08, A09, A10, A12, A14, A15, B01, B02, B08.
- Branch `docs/576-docs-set-b` starts at `d9d9897` (PR #580 / #574), because `origin/pre` at `2958fc2` does not contain that commit yet.

## Out of scope

- Code, tests, CI, `.delivery.yml`, and Worker wrangler values.
- Deploy, DNS, buckets, secrets, and env files.
- Findings owned by other cards (A07, A11, A13, B03–B07, C01).
- Rewriting `docs/VERCEL-DATA-OPERATIONS.md` or deleting it. Current docs stop treating it as the live host procedure.
- Merging, or pushing `main`, `pre`, or `preview`.
- Changing the #574 stage 2/3 recovery, stage 4 `wrangler rollback 14b84f73-ef31-4e86-a70d-b71251756093 --name gitstarclub-web`, bootstrap acceptance, or the stage 4 gate and build-shell checklist.

## Acceptance

- `bun run lint:docs` and `node scripts/check-docs.mjs` pass on Node v24.20.0 and Bun 1.3.14 with `--no-env-file`.
- R2-CUTOVER and OPS still agree on the #574 steps, and on the new stage 6 tool prerequisite.
- `git grep -n 'Vercel-first'` in current docs is empty. Remaining hits are listed and sit in archive, changelog history, or old plans.
- Preview is documented as public, `noindex,nofollow`, `Disallow: /`. `noindex` is not access control. The production trigger stays unverified.
