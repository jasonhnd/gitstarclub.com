# Issue 859: Astro P7 Worker cache contract

## Goal

Correct the opt-in built Worker test to verify publication-scoped page caching.

## Scope

Update the existing callback test and use isolated synthetic Worker bindings. Record verification evidence in the ignored card directory.

## Out of scope

Application behavior, other tests, deployment, production data, and cache configuration.

## Acceptance

Reproduce the original failure on the specified base. Verify a cold and warm page, a successful same-publication callback retaining the cached page, and a synthetic pointer switch selecting a different publication and a cold page. Preserve the other registered tests and assertions. Run the requested exact-commit checks and record their results.
