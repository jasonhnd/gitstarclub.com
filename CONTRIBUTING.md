# Contributing

GitStarClub uses document-driven development. Start with the maintained docs index in [docs/README.md](docs/README.md), then follow the implementation workflow in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) and the issue/PR rules in [docs/WORKFLOW.md](docs/WORKFLOW.md).

## Workflow

- Work from a GitHub issue and keep the PR scoped to that issue.
- Use a feature branch, open a PR, and include the issue linkage, scope boundaries, validation results, and reviewer notes.
- Target the branch requested by the issue or maintainer. Branch topology, staging, and promotion rules live in [docs/OPS.md](docs/OPS.md).
- Do not merge your own PR. Review has two passes: whether the change should merge, and whether it should run or deploy.

## Required validation

From `web/`, run the checks that match the change. For normal PRs, include at least:

```bash
bun run docs:check
bun run lint
bun run typecheck
bun test lib/
```

For build-level verification, set `BLOB_BASE_URL` and run:

```powershell
$env:BLOB_BASE_URL = "https://gitstarclub.com"
bun run build
```

## Documentation updates

Behavior, route, contract, operations, and visual changes require owning-doc updates in the same PR. Use [docs/README.md](docs/README.md) to find the owning document. Common entry points are [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md), [docs/WORKFLOW.md](docs/WORKFLOW.md), [docs/OPS.md](docs/OPS.md), and [docs/TESTING.md](docs/TESTING.md).

Keep docs truthful. If automation is planned but not enforced, label it `planned` or `target`; do not describe it as a current PR gate.

## Security

Do not commit secrets, tokens, local `.env` files, production data dumps, or credentials. Environment-variable ownership and operational handling are documented in [docs/OPS.md](docs/OPS.md).
