# Issue #540 — AGENTS.md as the shared agent contract

## Goal

Extend the root `AGENTS.md` so every agent that only reads that file gets the same contract: branches, delivery, forbidden executor actions, verification commands, and repository constraints. Keep the existing pointer and executable rules 1–5.

## Scope

- `AGENTS.md` (extend; do not delete existing content)
- this plan
- one `docs/CHANGELOG.md` entry under Unreleased

## Out of scope

- Editing `.grok/rules/pre-only.md`, `.delivery.yml`, CI workflows, the Worker wrangler config, or deploy scripts
- Pushing `main`, `pre`, or `preview`; merging; force-push; deleting branches or files
- Live `wrangler deploy`, `wrangler versions upload`, Cloudflare schedule / DNS / route / secret changes
- Calls to production cron or refresh endpoints
- Secrets, tokens, account IDs, real environment values, or model names
- Incidental `bun.lock` changes from `bun install`

## Approach

1. Read `AGENTS.md`, `.grok/rules/pre-only.md`, `.delivery.yml`, the `static` and `production-build` jobs in `.github/workflows/ci.yml`, `docs/GEO.md`, `docs/TESTING.md`, and the root / `web` / `pipeline` package scripts.
2. Run the CI `static` mirror locally with Node 24 (`.node-version`) and Bun 1.3.14 (root `packageManager`). The machine default may differ; the runtime assert is the check.
3. Try the `production-build` fixture (`web/scripts/ci-build-fixture-server.ts` on `127.0.0.1:4010`, then `bun run build` in `web/`). Try `bun run cf:build:pre` and `bun run cf:dry-run` the same way the optional `cf-workers-host` job does. Never deploy.
4. Put a command in `AGENTS.md` only after it succeeds locally. Record pass/fail, counts, and duration in the PR body. Omit failures instead of guessing steps.
5. Replace the sentence that says this file does not repeat or override the branch and delivery rules. Restate those rules here, and say `.grok/rules/pre-only.md` and `.delivery.yml` must stay consistent with this file.

## Reconciliation

- Executable rule 3 stays verbatim: do not merge to `main` automatically; merging to `pre` is allowed. The new Forbidden section applies to executors: the reviewer or owner squash-merges feature PRs into `pre`. Rule 3's meaning does not change.
- Executable rule 5 stays verbatim, including its zh / zh-TW / ja exception sentence. The Repository constraints section states the current site locales (`en`, `ja`, `zh`, `zh-TW`, `ko`, `es`, `fr`) and the paths `bun run lint:docs` allows. That later section is the complete contract the issue requires.
- `.grok/rules/pre-only.md` still says implement, open PRs, merge, and rebase only against `pre`, and do not target `main`. This file restates that and adds: never push directly to `pre` or `main`; promotion is a separate `pre` to `main` PR with a merge commit, and only when the owner explicitly says "push main" or "promote to main". Those two files are not edited in this change; they must be kept consistent afterward.
- `.delivery.yml` required checks stay `static` and `production-build`. `preview-e2e`, `product-gates`, `cf-preview`, and `cf-workers-host` stay optional and must not be made required.

## Notes

`scripts/check-docs.mjs` treats a backtick span containing `workers/.../wrangler.jsonc` as the repository path `web/wrangler.jsonc`, which is not a file. This plan therefore does not backtick that path.

The active ruleset `release gates (pre/main)` requires a pull request into `pre` and `main`, blocks force-push and branch deletion, and requires status checks `static` and `production-build`. It allows merge, squash, and rebase. The merge-commit rule for promotion and the squash rule for feature PRs are policy in `AGENTS.md`; the ruleset does not force the method.

## Acceptance

- Rules 1–5 remain, with the same meaning.
- All six issue sections are present and match `.grok/rules/pre-only.md`, `.delivery.yml`, and `.github/workflows/ci.yml`.
- Every verification command listed in `AGENTS.md` was run locally; the PR body pastes each result.
- `bun run lint:docs` passes.
- `git grep -n -i -E 'token|secret|password|api[_-]?key' -- AGENTS.md` shows only rule text.
- No model names in `AGENTS.md`.
- `git status --porcelain` is clean after the commits.
