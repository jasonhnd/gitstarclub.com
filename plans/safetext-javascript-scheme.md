# SafeText: block only the javascript: URL scheme

- **task_id**: `gitstarclub-safetext-javascript-scheme-cca-0774`
- **target branch**: `pre` (do not touch `main`)
- **Issue**: #513
- **authorization**: Lead — reversible SafeText fix; do not ask Jason

## Goal

`refresh-2026-09-22T00-40-32-142Z` was false-killed in metadata bucket 3 by `/javascript:/i`. Tighten the check so it blocks only a real `javascript:` URL scheme. Keep the protection. The unpublished 65015 set stays reusable.

## Scope

- `containsJavascriptUrlScheme` + `SafeText` refine
- Regression: LABjs / simpl source text passes; `javascript:alert(1)` is rejected
- One sentence in the contract

## Out of scope

- Do not change `main` / production
- Do not turn off `WHITELIST_SEARCH_SHARDS` / do not go back to unsharded Search
- Do not live-deploy, do not send a Bearer request, do not use the `/start` fixture
- Do not remove the `javascript:` protection

## Acceptance

1. `JavaScript:` inside a description passes `SafeText` / `ReposShard`
2. A real `javascript:` URL is still rejected
3. Required CI: `static` + `production-build`
