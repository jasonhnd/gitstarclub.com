# Recover metadata pages that repeatedly return GitHub 502

Issue: [#716](https://github.com/jasonhnd/gitstarclub.com/issues/716).

## Goal

Allow a refresh to finish when a repository metadata page repeatedly returns
HTTP 502, without inventing star counts or losing resumable progress.

## Scope

- Reproduce bucket 26 from the immutable October 21, 2026 preview whitelist,
  using the existing modulo-32 grouping, 100-id pages, and GraphQL selection.
- Bisect exhausted 502 pages down to individual node ids. Record every skipped
  repository with its id, owner/name, and reason in durable run progress and the
  workflow log, including a count.
- Checkpoint successful subpages and skips before continuing. Reset exhausted
  retry budgets when borrowing progress into a new run and after actual progress.
- Preserve a skipped repository's previous metadata. Without previous metadata,
  omit its numeric row so the existing missing-page behavior applies. Permit only
  explicitly recorded missing repositories through the publication membership
  gate; unrelated missing data must still block publication.
- Add focused tests and a short operations note. Extend internal progress
  contracts compatibly only where required for resumability and auditing.

## Out of scope and forbidden actions

No coverage expansion, new pages, deployments, refresh/start/cron requests,
object-store writes, platform CLI commands, infrastructure or CI configuration
changes, secret changes, force pushes, protected-branch pushes, or PR merges.
GitHub diagnosis uses read-only queries and never prints credentials.

## Acceptance

- Record the exact snapshot, bucket/page membership, query outcomes, and any
  isolated failing ids in the PR.
- Test recursive splitting, exhausted singleton skips, checkpoint resume,
  borrowed and in-run retry budgets, retained previous values, missing newcomers,
  and absence of fabricated zero values in entities and rankings.
- Run the complete AGENTS.md bootstrap, offline static job, coverage suite, and
  fixture production/pre builds and artifact checks at the exact committed head
  in one fresh detached shared clone. Use the owner-authorized shared toolchain
  and shared Bun cache. Never run Wrangler or cf:dry-run.
- Open one issue and one PR into pre, report verification and remaining risks,
  leave a clean worktree, remove temporary verification artifacts, and hand off
  to the board-selected independent reviewer without merging.
