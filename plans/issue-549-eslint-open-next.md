# Issue 549: ESLint ignores OpenNext build output

## Goal

`bun run lint` in the web app stays at zero errors after `cf:build` or `cf:dry-run` writes generated OpenNext output under `.open-next`.

## Scope

1. `web/eslint.config.mjs`: add `.open-next/**` in the same `globalIgnores` list as `.next/**`.
2. `AGENTS.md`: the live sentence says ESLint ignores `.next` and does not ignore `.open-next`, and that the verification block lints before `cf:dry-run`. Issue #549 calls this a "delete `.open-next` before linting" workaround. That delete sentence is not in the file. Update the ignore sentence so generated output can stay on disk. Keep the fact that the verification block still lints before `cf:dry-run`, because that is the script order.
3. This plan.
4. One Unreleased entry in `docs/CHANGELOG.md`.

## Out of scope

- Push to `main`, `pre`, or `preview`. Merge. Force-push. Deleting branches or files.
- Wrangler write commands, Cloudflare schedule, DNS, route, or secret changes.
- Blob writes and production endpoints.
- CI workflows, `.delivery.yml`, the Worker wrangler config, and deploy scripts.
- Reordering the verification script.

## Acceptance

- From `web/`, `bun run cf:build:pre` with the fixture in `AGENTS.md` (`BLOB_BASE_URL` on `127.0.0.1:4010`, `HOSTING_TARGET=cf`), then `bun run lint`, exits 0.
- `bun run lint:docs` passes.
- The `AGENTS.md` verification commands pass on a fresh detached worktree of the commit.
