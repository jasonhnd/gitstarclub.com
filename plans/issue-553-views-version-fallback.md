# Issue 553: read-only views version fallback

## Goal

Production pages currently render no ranking data because `views/latest.json` is missing. Serve the last complete version, `refresh-2026-09-13T06-00-16-398Z`, without writing to the Blob store. Issue #543 is the incident; this change is the temporary read path.

## Scope

1. `web/lib/runtime-config.ts`: read `VIEWS_VERSION_FALLBACK` through the same Worker env resolution as the other Worker vars. Accept only `refresh-YYYY-MM-DDTHH-MM-SS-mmmZ`. Ignore any other value and log once.
2. `web/lib/data/source.ts`: in `resolveVersion`, use that value only for a published read after a confirmed 404 of `views/latest.json`. Take `published_at` from `generated_at` in `views/<version>/meta.json` when it is a real timestamp, otherwise null. Leave `confirmedAbsent` false so the bootstrap and legacy-flat branch is not taken. Do not use the fallback on timeout, 5xx, invalid JSON, or in authoritative mode. An existing pointer always wins. Log once per isolate when the fallback is in effect.
3. Worker wrangler config, top-level `vars` only: set the production value and a comment that points at #543 and says to remove the var after the pointer is restored. Do not set it on `env.pre`.
4. `scripts/cf-ci-gates.mjs`: require that production value, and reject it on preview.
5. Tests for the cases above.
6. `docs/OPS.md`: incident note, including how to remove the var.
7. This plan, and one Unreleased entry in `docs/CHANGELOG.md`.

## Out of scope

- Push to `main`, `pre`, or `preview`. Merge. Force-push. Deleting branches or files.
- Any Blob write, wrangler write command, schedule, DNS, route, or secret change.
- Calls to production endpoints.
- Restoring `views/latest.json` itself (that stays with #543).

## Acceptance

- The tests in the issue exist and pass, and the `AGENTS.md` verification commands pass on a fresh detached worktree of the commit.
- A fixture production-target build still passes its indexing self-check.
- The diff adds no store `put`, `del`, or write call.
