# Issue 604: reject empty and malformed coverage reports

## Goal

Close code-health finding E01 / S01. The coverage CLI must fail closed when an LCOV report is empty, missing aggregate counters, malformed, negative, or has hit greater than found. Exact 80% and a valid 90% report still pass.

## Scope

- `scripts/check-coverage-threshold.mjs`: require LF, LH, FNF, and FNH; accept only nonnegative integers; reject hit greater than found and a zero found total before the ratio; stop treating a zero denominator as 100%.
- `web/lib/coverage-gate.test.ts`: CLI controls for empty, malformed, missing, negative, and hit-greater-than-found reports, plus 80% and 90% success.

## Out of scope

- Page copy, layout, CSP, the language switcher, and the Star component.
- CI workflows, `.delivery.yml`, and Worker wrangler config.
- Any file other than the script, its test, and this plan.

## Acceptance

- The CLI exits non-zero for empty, malformed, missing counters, negative counters, and hit greater than found.
- Exact 80% and a valid 90% report still pass.
- New rejection tests fail if the validation is removed.
- The AGENTS.md static job and fixture production build pass in a fresh detached worktree.
