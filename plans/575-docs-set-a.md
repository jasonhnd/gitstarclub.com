# Issue #575 — docs audit set A

## Goal

Align the docs and Cursor role files named by audit findings A07, A13, A11, B03, B04, B06, B07, and C01 with `origin/pre` at `2958fc2`. Where the audit and the code disagree, follow the code and say so in the pull request.

## Scope

- `docs/DEVELOPMENT.md` and `docs/DATA-EXPORTS.md` (A07)
- `.cursor/agents/*.md` (A13). Role text defers to root `AGENTS.md`. Remove the requirement that repository writes go only through a Cursor cloud agent or a separate VPS. Do not change `model` or `readonly` frontmatter.
- `docs/ARCHITECTURE.md`, `docs/FRONTEND.md`, and `docs/UIUX-ROUTE-INVENTORY.md` (A11, B03, B04)
- `docs/TESTING.md` (B06)
- `docs/geo/queries.md` (B07)
- `README.md` and `AGENTS.md` (C01)
- this plan

## Out of scope

- Other audit findings and the docs they name (`docs/GEO.md`, `docs/SEO.md`, `docs/OPS.md`, migration docs)
- `.grok/rules/pre-only.md`, `.delivery.yml`, CI workflows, Worker wrangler config, deploy scripts
- Application code, tests, and lockfiles
- Pushing `main` or `pre`, merging, force-push, deleting branches or files
- Cloudflare or Vercel API calls, live wrangler deploy, production cron or refresh, secrets, and real buckets

## Acceptance

- Default delivery text stops on `pre`. Promotion to `main` and a production refresh each require an explicit owner authorization. Promotion still uses a merge commit.
- Role files follow `AGENTS.md` and do not require a Cursor cloud agent or a VPS. Frontmatter model settings are unchanged.
- Page cache, data cache, and active invalidation are written per route. Repo, org, and category detail stay at `revalidate=604800`. Category index and dimension stay at `86400`. Org index stays at `3600`. Ranking history stays at `revalidate=false`.
- OG cards are `next/og` routes plus the site-card fallback. Sitemap ranking paths follow available published periods.
- `docs/TESTING.md` no longer cites a drifting test count. Partial browser coverage is distinguished from the CI Playwright command and from coverage that is still absent.
- About evidence paths point at `web/app/_localized/about.tsx` and the about adapters. The public URL stays `/about`.
- README and `AGENTS.md` describe a prerendered core, an on-demand long tail, and near-zero client JavaScript with listed islands.
- `bun run lint:docs` and `node scripts/check-docs.mjs` pass.
