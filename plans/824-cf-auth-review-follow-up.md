# Issue #824: cf authentication review follow-up

## Goal

Make the transient 401 retry require a confirmed authenticated CLI session and the exact authentication API error.

## Scope

- Check `cf auth whoami` JSON even when cf exits successfully.
- Require API error 10000 with the final boxed 401 status.
- Update operator guidance and fake-runner tests.

## Out of scope

Bucket access, credentials, deployments, branch changes, and unrelated retry behavior.

## Acceptance

- Exit-zero unauthenticated or malformed `whoami` output stops with the login hint; an authenticated response with `tokenValid: false` can retry.
- A boxed 401 with another API error code fails immediately.
- The requested pipeline and full web coverage suites pass on the current branch.

## Verification

- Requested frozen installs and suites passed. Web reported 2,561 passed, 49 skipped, zero failed; coverage passed at 90.50% lines and 91.07% functions.
- All three web typechecks passed. Web lint passed with 14 warnings in untouched files.
- Documentation lint remains blocked by ten pre-existing broken performance-script references in older plans.
- No bucket access, credentials, deployment, branch switch, or repository copy was used.
