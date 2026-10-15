# GSC_0013 promotion

## Goal
Promote the owner-approved pre commit eb24ac8600bc49ba7b251385e0534e61b4ffae5e to main through a merge-commit pull request.

## Scope
Record remote heads and included pull requests; verify the exact approved commit with the AGENTS.md bootstrap, full static job, fixture production build, and Cloudflare dry run. Report real local results as commit statuses and merge only after success.

## Out of scope
Deployments, production endpoints, settings, Actions, direct branch pushes, and code changes.

## Acceptance
The approved head is unchanged, verification passes, the promotion uses a merge commit, and fetched origin/main contains the approved head. Stop and report any conflict, failed check, or refused merge.
