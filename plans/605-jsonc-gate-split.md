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

## PR #634 integration follow-up (GSC_0062)

### Goal and scope

Merge the latest `origin/pre` into the existing PR branch with a merge commit.
Resolve the CF gate conflict by carrying the complete #630 production stage-4
contract into the extracted validators, while retaining #579 hardening and the
JSONC string scanner. Preserve all conditions, exact diagnostics, and their
order. Scope is the conflicted gate implementation, gate tests, this plan, and
any changelog conflict; changes arriving from `pre` remain intact.

### Restrictions

No new behavior, rebase, force push, PR merge, protected-branch push, branch or
file deletion, deployment, Cloudflare/Vercel API call, credential or local
environment-file read, or edits to workflows, delivery policy, or Worker config.

### Acceptance and delivery

- Keep every #630 and #579 gate regression, and prove their conditions and
  ordered diagnostic output match the latest `pre` implementation.
- Pass `node --test scripts/cf-ci-gates.test.mjs scripts/check-docs.test.mjs` and
  `node scripts/assert-cf-ci-gates.mjs` with the pinned toolchain.
- Pass the complete static job in a fresh detached verification worktree,
  with a clean environment and no live checks; use `/tmp/GSC_0062/` for artifacts.
- Push only the existing PR branch, confirm PR #634 has no merge conflict, and
  update its verification record to the new head.
- Report the new head, every transferred check, test results, and remaining
  risks through GSC_0062 for independent Claude-family review.
