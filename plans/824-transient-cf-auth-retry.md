# Issue #824: Retry transient cf authentication failures

## Goal

Keep repair publication running through one transient HTTP 401 authentication
failure from the pinned Cloudflare CLI (`cf`) without weakening write safety.

## Scope

- Inspect the pinned CLI's boxed API error output and recognize only an
  authoritative 401 Unauthorized authentication failure.
- Share one in-flight `cf auth whoami` refresh across parallel failed calls,
  wait three seconds plus jitter, and retry each original call at most once
  for authentication, independently of its six rate-limit retries.
- Reuse the exact-key and byte comparison guard before any put resend.
- Cover recognition, concurrent refresh, failure, writes, and mixed retry
  sequences using fake runners and injectable sleeps; update OPS guidance.

## Out of scope

Bucket access, credentials, deployments, CLI upgrades, branch changes, and
changes to publication policy, CI workflows, or deployment configuration.

## Acceptance

- Real boxed 401 output, including ANSI decoration, refreshes and retries;
  four concurrent failures share one refresh.
- A second 401 fails with `cf auth login` and safe-rerun guidance. Other
  statuses and misleading body text fail without an authentication retry.
- Writes skip identical existing bytes, reject different bytes, and resend
  only after proven absence; HTTP 429 retry behavior remains intact.
- Run the requested install, pipeline tests, and full web coverage suite,
  plus applicable static checks and local fixture builds. Remain on the
  current branch and commit completed steps.
- Verification runs in the existing repository because the card explicitly
  prohibits copying it or switching checkouts; no environment files or live
  endpoints are used.

## Verification

Implementation tested at `d3418c6` on the unchanged branch `ib/gsc-824i`.

- Inspected `cf@1.0.0-beta.18` in the installed package: `Gr` in
  `dist/src-BUH-P_zd.mjs` appends the authoritative status inside the APIError
  box and prints the login hint afterward; `dist/blocks-Bat9A8V_.mjs` supplies
  the box prefixes and preserves raw message lines.
- The fake-runner tests cover plain and ANSI-decorated read failures, four
  concurrent callers sharing a refresh and cooldown, a late rejection joining
  that cooldown, repeated 401s, failed refresh cleanup, misleading error bodies,
  independent retry limits, and exact-key write safety for both 401 and 429.
- The owner's complete frozen-install and test command passed using the
  requested `KANBAN_TMP` and `TMPDIR`: pipeline 211 passed, zero failed; web
  2,556 passed, 49 skipped, zero failed across 224 files. Coverage gate passed:
  90.50% lines and 91.07% functions. Web output is in
  `$KANBAN_TMP/824i-requested-tests.log`.
- Additional static checks ran with a clean environment. Runtime assertions
  passed with Node v24.21.0 and Bun 1.4.2. Web dependency audit, CI configuration
  assertions, lint, all three typechecks, view fixture validation, and host graph
  validation passed. Lint has 14 warnings in unchanged files.
- Both local fixture builds and matching host validations passed: production
  and pre each have 234 routes and 467 artifacts, with their expected indexing
  settings. Logs are under `$KANBAN_TMP/824i-build-*.log` and
  `$KANBAN_TMP/824i-host-*.log`. The fixture process was stopped afterward.
- Broader static verification still has the failures documented on the prior
  card: pipeline dependency audit reports two high-severity advisories for
  transitive undici 6.28.1 and zod 4.1.11, and documentation checks report ten
  stale performance-script links across five existing plans. These files and
  dependencies were not changed. Details are in `$KANBAN_TMP/824i-pipeline-audit.log`
  and `$KANBAN_TMP/824i-docs.log`.
- All dependency locks remained unchanged. No browser, credentials, bucket
  access, deployment, push, repository copy, or branch switch was used.
