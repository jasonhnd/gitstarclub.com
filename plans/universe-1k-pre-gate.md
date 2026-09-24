# ≥1k universe: pre gate

- **task_id**: `gitstarclub-universe-1k-pre-gate-cca-001`
- **target branch**: `pre` (do not touch `main`)
- **authorization**: Jason 2026-09-21 JST, "≥1k: turn it on now"

## Goal

Change the floor for the universe included in rankings / refresh from a hardcoded ≥10,000 stars to a reversible gate, and open ≥1,000 on preview. Page opens use precomputed data only.

## Scope

- Resolve `MIN_TRACKED_STARS` at runtime, default `10000`
- wrangler `env.pre.vars.MIN_TRACKED_STARS=1000`
- CF CI gate: preview must be `1000`; the production top-level must not be set to `1000`
- Sync docs / env inventory

## Out of scope

- Do not change `main` / the production default
- Do not compute on the page-open path
- Do not reopen the four ≥100 / query-plane items from #362
- Do not treat a shallow short menu as the product direction
- Do not run a production refresh this time

## Acceptance

1. The default / production floor is still ≥10k
2. Preview config reads as ≥1k, and `assert-cf-ci-gates` locks that
3. Rollback: remove `MIN_TRACKED_STARS` or set it back to `10000`
4. A real expansion happens only on the next **non-fixture** full refresh
