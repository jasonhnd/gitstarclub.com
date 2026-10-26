# Card 824-E: repair rollback follow-up

## Goal
Address the independent review of issue #824 part D.

## Scope
Correct the Mac repair rollback procedure and rollback catalog in OPS. Set
sealed-generation rollback verification concurrency to 1, matching seal.

## Out of scope
Other review nits, bucket access, credentials, deployments, branch changes,
pushes, and merges.

## Acceptance
The documentation describes guards, lease writes, verification inputs, pointer
conditions, and retarget semantics accurately. Run the requested frozen installs,
full pipeline suite, and full web coverage suite. Deliver one small commit.

## Verification
- Requested frozen installs: passed with Bun 1.4.2.
- Full pipeline suite (`bun test --timeout 30000`): 208 passed, 0 failed.
- Full web coverage suite (`bun run test:cov`, placeholder data origin,
  live SEO opt-in empty): 2,402 passed, 49 skipped, 0 failed; line coverage
  90.47%, function coverage 91.05%.
- `bun run lint:docs`: blocked by eight existing unresolved references to
  `scripts/perf-local.ts` and `scripts/perf-metrics.ts` in unchanged plans.
- `git diff --check`: passed.
