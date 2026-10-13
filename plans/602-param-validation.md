# Issue 602: Validate public path parameters

## Goal

Reject malformed public repository, organization, and ranking parameters before
they reach storage keys or social image rendering. Next.js decodes route segments;
application handlers validate those decoded values without decoding them again.

## Scope

- Add shared bounded validators for GitHub logins, repository names, repository
  IDs, and ranking year/month/ISO-week identifiers.
- Apply them to repository/organization pages and metadata, parameterized social
  image routes, and entity/rank readers before any storage path is constructed.
- Preserve existing valid routes and canonical repository names. Ranking images
  require a published rank and render a generic site card for invalid/missing data.
- Add adversarial regression tests and document the public input contract.

## Out of scope

No production requests, real data stores, platform APIs, deployment, merge,
credential/environment-file reads, CI/Worker configuration changes, or dependency
lockfile changes. Do not edit the source comments from prerequisite issue 577.

## Steps

1. Inspect issue 602 and the S05 report against the latest origin/pre; install the
   checksum-verified Node 24.20.0 and Bun 1.3.14 dependencies; capture old images.
2. Implement shared validation and integrate page, image, and data boundaries.
3. Add regression tests, prove the old implementation fails them, and capture
   updated images for the pull request.
4. Verify the committed implementation in a fresh detached worktree, push only
   fix/602-param-validation, and open one pull request against pre.

## Acceptance

- Invalid/malformed/encoded/overlong segments cause controlled 404s or the generic
  image without input-derived storage reads. No second decode or URIError.
- Valid GitHub names and canonical ranking periods retain expected behavior.
- New boundary tests fail when the relevant production fixes are removed.
- The full static job, coverage thresholds, fixture production build, and local
  Cloudflare dry run pass in env -i with all live checks disabled.
- Include before/after ranking image captures, Closes #602, exact verification,
  and remaining risks in the pull request and Kanban handoff.

## Baseline

Fetched origin/pre at b9650f0 on 2026-10-01. Issue 585 is merged; repository
images still decode parameters twice and ranking images still read arbitrary
periods. Prerequisite PR 624 is open and only changes comments; this fix does not
touch those files.
