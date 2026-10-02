# Issue 609: prune data getters and share rank/index projection

## Goal

Resolve code-health findings A04, L03, and L04 without changing rendered pages,
payload selection, public getter signatures, or read freshness.

## Scope

Only the eight source/test paths listed in issue #609, plus this required plan:

- Remove the unused category dimension filter and six unused internal exports
  after confirming that tracked code and tests have no consumers.
- Share the normal/daily rank selection flow using the existing pure payload
  selector, with explicit base readers and pointer TTL policies.
- Share the pure lowercase repository-name index construction.
- Add read-policy regression coverage, including read order, fallback, TTL,
  authoritative paths, and the remaining public category filtering behavior.

## Out of scope

No source.ts, storage, workflow, CI, deployment configuration, page appearance,
CSP, language-switcher, ranking-period resolver, or production changes.
Do not read credentials or local environment files. Do not deploy, access real
data buckets, merge, force-push, or push protected branches.

## Steps

1. Confirm the prerequisite card, fetch origin/pre, create the issue branch, and
   install dependencies with the repository's checksum-verified pinned tools.
2. Remove confirmed dead exports and consolidate selection/index construction.
3. Add and run behavior-focused policy tests without process-global mocks in the
   parent test process; use isolated child processes for module substitutions.
4. Verify the committed head in a fresh detached worktree inside this card's
   directory using the full clean-environment static job and fixture builds.
5. Push only refactor/609-data-getters and open one PR against pre for review.

## Acceptance

Normal/daily reads choose identical payloads and keep their distinct TTLs and
lazy read order. Retained getters keep their signatures. Active authoritative
readers preserve paths, options, and error propagation. Removed exports have no
tracked consumers. The full web coverage suite, lint, all three typechecks,
view validation, pipeline tests/audits, documentation checks, fixture production
build, and fixture-only Cloudflare dry run pass. No lockfile churn is committed.
Policy mutations must fail regression tests; this is a behavior-preserving
refactor, so a full production rollback should still pass behavioral tests.

## Delivery

The PR contains Closes #609, the change summary, commands/results, and remaining
limits. Kanban handoff includes files, verification, risks, and the PR URL.
Independent review must use the Claude/anthropic family. No executor merge.
