# Worker edge cache

## Goal

Reduce repeated Next rendering and data reads with Cloudflare's local Cache API.

## Scope

- Add a testable Next response cache with request exclusions, response eligibility,
  representation isolation, versioned keys, and a one-day lifetime cap.
- Wire it after shell routing, extend environment types, and document invalidation.
- Run lint, typechecks, host tests, documentation checks, and the offline web suite.

## Out of scope

No incremental-cache configuration, deployment configuration, production requests,
secrets, commits, deployment, or pull request changes.

## Acceptance

Eligible repeated GET requests return identical content with HIT; excluded requests
and responses bypass storage. RSC variants and versions cannot share keys. Cache
failures preserve Next responses. All requested checks pass.
