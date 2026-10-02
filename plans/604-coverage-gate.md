# Issue 604: reject empty and malformed coverage reports

## Goal

Close code-health finding E01 / S01. The coverage CLI must fail closed when an LCOV report is empty, missing aggregate counters, malformed, negative, or has hit greater than found. Exact 80% and a valid 90% report still pass.

## Scope

- `scripts/check-coverage-threshold.mjs`: require LF, LH, FNF, and FNH once each on every LCOV record; accept only nonnegative integers; reject a second SF before end_of_record and reject a repeated summary counter before adding it. Reject hit greater than found on that record before it is added to the aggregate. A record with zero functions stays valid when the summed aggregate still has lines and functions. A zero found total on the aggregate still fails before the ratio. A zero denominator is not treated as 100%.
- `web/lib/coverage-gate.test.ts`: CLI controls for empty, malformed, missing, negative, hit-greater-than-found, missing record separators, and duplicate summary counters, plus 80% and 90% success. Mixed-record CLI controls cover a missing counter and hit greater than found beside an otherwise valid record. A zero-function record beside a covered record still passes.

## Out of scope

- Page copy, layout, CSP, the language switcher, and the Star component.
- CI workflows, `.delivery.yml`, and Worker wrangler config.
- Any file other than the script, its test, and this plan.

## Acceptance

- The CLI exits non-zero for empty, malformed, missing counters, negative counters, and hit greater than found, including when a later valid record would hide the defect in a sum.
- The CLI exits non-zero when a second SF appears before end_of_record, and when LF, LH, FNF, or FNH is repeated inside one record.
- Exact 80%, a valid 90% report, a valid multi-record report, and a zero-function record inside a nonempty aggregate still pass.
- New rejection tests fail if the validation is removed.
- The AGENTS.md static job and fixture production build pass in a fresh detached worktree.
