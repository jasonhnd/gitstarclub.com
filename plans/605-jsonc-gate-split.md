# Preserve JSONC strings and split read-only gate validators

## Goal

Resolve issue #605 findings S02 and S03 without changing CI policy, deployment controls, diagnostic messages, or site appearance.

## Scope

- Update `scripts/cf-ci-gates.mjs` and `scripts/cf-ci-gates.test.mjs`.
- Update `scripts/check-docs.mjs` and `scripts/check-docs.test.mjs`.
- Keep this required task plan under plans/; no other files are changed.

## Out of scope

CI workflows, delivery policy, Worker configuration, dependency lockfiles, deploy scripts, live services, secrets, storage cutover, UI changes, merge, and protected-branch pushes.

## Steps

1. Install frozen dependencies using checksum-verified Node v24.20.0 and Bun 1.3.14.
2. Add parser regressions, demonstrate failures on the baseline, and implement a single string-aware comment scanner.
3. Extract cohesive read-only validators while preserving assertion order, conditions, and diagnostic text. Add characterization coverage for combined failures and source immutability.
4. Verify the committed result in a fresh detached worktree with a clean environment, the complete static job, fixture production build, and preview dry run. Remove the verification tree.
5. Push only refactor/605-jsonc-gate-split and open one PR into pre with Closes #605. Hand off for independent Claude-family review.

## Acceptance

- Quoted line and block comment markers, escaped quotes and backslashes round-trip unchanged; real line and multiline block comments are removed outside strings.
- New behavioral regression tests fail when the parser fix is removed.
- Existing gate assertions and diagnostic messages are preserved, including ordering on combined failures.
- Full static checks and fixture production build pass under the pinned toolchain without live credentials or real data access.
- No changes to workflows, delivery policy, Worker configuration, or lockfiles.
