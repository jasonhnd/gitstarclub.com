# Pin the production page-cache namespace

## Goal

Bind production GSC_CACHE to the owner-supplied existing namespace so the #773 production guard accepts the real production build.

## Scope

- Pin production to e25483e6f01d4c68a7b014906f247a37 and preserve preview 4c3107414bad4a0386fedfcf96dde6e2 in the shared host contract.
- Update the host comment, operational documentation and regression tests for both web and Astro factories.
- Run the full Astro suite, shared web static checks, and the real production build, local host validator and artifact-only guard with card-local KANBAN_TMP.

## Out of scope

Deployments, cf calls, Wrangler, namespace creation, resource changes beyond the requested binding, branch changes, repository copies and CI edits. Verification runs in place on the current branch under the owner's explicit workspace rule.

## Acceptance

- Production and preview select their exact, different namespace IDs; other modes retain their existing behavior.
- The full Astro test suite passes with card-local temporary output.
- The real non-fixture build:production artifact passes the #773 production guard and local host validation without calling cf or deploying.
