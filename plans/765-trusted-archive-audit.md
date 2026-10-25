# Issue 765: trusted archive v0.1 audit

## Goal

Document the current Astro site's data transparency gaps before the product specification is written.

## Scope

- Inspect `origin/feat/astro-site` through Git without switching the current branch.
- Read the English and Japanese preview pages for every requested page type.
- Inspect the published data pointer, export metadata, and refresh publication code.
- Write `docs/analysis/trusted-archive-v01-gap.md` with one fact matrix and a short list of unused published fields.

## Out of scope

Page, component, data, configuration, and deployment changes; refresh execution; branch switching; pushing.

## Acceptance

- Cover home, Pulse, rankings index, week/month/year/all-time detail, repository, organization, category, compare, About, and exports/downloads.
- Assess date and data layer, coverage and set definition, method, citation, and release linkage with source paths.
- Distinguish live evidence from source-only findings and identify public refresh-history limitations.
- Run `bun run lint:docs` and record its result.
