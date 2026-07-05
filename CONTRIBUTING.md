# Contributing

GitStarClub uses a document-driven workflow. This file is the entry point for
contributors; the authoritative development, workflow, and operations rules live
in the docs linked below.

## Start Here

- Read the docs index: [docs/README.md](docs/README.md).
- Use [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for development playbooks,
  documentation ownership, and local validation commands.
- Use [docs/WORKFLOW.md](docs/WORKFLOW.md) for issue shape, branch scope, PR
  expectations, merge gates, and visual-change guardrails.
- Use [docs/OPS.md](docs/OPS.md) for branch topology, staging, deployment,
  rollback, cron, Workflow, Blob, and environment-variable operations.

## Workflow Summary

- Start from a GitHub issue and keep the branch scoped to that issue.
- Substantive behavior, route, contract, operations, and visual changes are
  document-first: update the owning doc in the same PR, or land the source of
  truth before implementation when the workflow requires it.
- Feature work targets `pre`; production promotion is a merge from `pre` to
  `main`.
- PRs should state the summary, issue linkage, scope boundaries, validation
  results, and reviewer notes. Use `Closes #N` only when the PR fully completes
  the issue.

## Validation

Run the validation requested by the issue and PR. For code changes, the default
local set is:

```text
cd web
bun run lint
bun run typecheck
bun run typecheck:tests
bun run typecheck:scripts
bun test lib/
bun run build
```

For docs-only changes, state that no code validation was required. Vercel preview
or production checks remain the final verification path when deployment behavior
is involved.

## Documentation Updates

The owning document must change with the behavior it describes. In particular,
behavior, route, contract, operations, and visual changes require owning-doc
updates. Use [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) to find the owner and
[docs/README.md](docs/README.md) for the full document map.

## Security And Secrets

Do not commit secrets, tokens, credentials, `.env` files with real values, or
private operational output. `NEXT_PUBLIC_*` values are exposed to the client, so
only non-sensitive values belong there; see [docs/OPS.md](docs/OPS.md) for the
environment-variable rules.
