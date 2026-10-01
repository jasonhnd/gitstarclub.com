# PR 616: merge the current pre branch

## Goal

Merge the latest `origin/pre` into the existing PR 616 history with a merge commit. Preserve the built-commit deployment identity from issue 587 and the secret-safe logging from issue 601.

## Scope

Resolve conflicts in `workers/gitstarclub-web/src/shell.ts` and `docs/CHANGELOG.md`. Retain both deployment identity and sanitizer imports, all pre sanitizer calls and string bindings, and all release entries. Record this plan and update the existing PR verification for the new head.

## Out of scope

New features, rebasing, force-pushing, PR merges, pushing protected branches, deployments, Cloudflare or Vercel API calls, credentials or environment files, and edits to CI, delivery, or wrangler configuration.

## Acceptance

- A merge commit includes the latest `origin/pre` and the previous PR head as ancestors.
- No conflict markers remain; both sets of changelog entries survive.
- The complete AGENTS.md static job passes in a fresh detached worktree with Node v24.20.0 and Bun 1.3.14 under a clean environment.
- Worker-host and deployment tests pass; local fixture builds and the pre-only wrangler dry run pass.
- PR 616 targets `pre`, has no merge conflict, and records verification of the new head.
- The execution checkout is clean and the output is handed to the reviewer.
