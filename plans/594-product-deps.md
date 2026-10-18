# Product dependency updates (#594)

## Goal

Move the `web/` product dependencies to the versions named in issue #594 and
absorb the open Dependabot PRs that are still applicable, in one branch and one
pull request against `pre`.

## Scope

- `web/package.json` and `web/bun.lock` only:
  - `react` and `react-dom` 19.2.8 -> 19.3.0 (supersedes #435, #436).
  - `@types/react` and `@types/react-dom` -> ^19.3.0 (the type packages for the
    React 19.3 line).
  - `three` -> ^0.186.0 (supersedes #437) and `@types/three` -> ^0.186.0
    (supersedes #507).
  - `zod` -> ^4.6.5.
- Fix any call site that breaks, with the smallest change that works.
- Run the full gate in a fresh detached checkout of the exact head and record
  the results in the pull request body.
- Before and after screenshots of the home page, one ranking page, and the
  `/cockpit` radar (three.js) from the fixture build.

## Already applied on `pre` (nothing to absorb)

- #429 `next` and `eslint-config-next` 16.3.3: `pre` is already on 16.3.8.
- #506 `@duckdb/node-api` 1.5.5-r.5: `pre` is already on 1.5.6-r.1.

## Out of scope

Data coverage, CI workflows, `.delivery.yml`, Worker wrangler config, deploys,
cron or refresh endpoints, closing or merging the Dependabot pull requests.

## Acceptance

- The full AGENTS.md gate passes on the head commit: web and pipeline audit,
  pipeline tests, `lint:docs`, web lint, three typechecks, view validation,
  `test:cov`, the fixture production build, and `cf:dry-run`.
- Screenshots show no unintended visual change.
- Any bump that cannot be fixed with a small change is left out, with the reason
  written in the pull request.
