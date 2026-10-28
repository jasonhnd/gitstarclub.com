# Repair performance references — issue 853

Refs #853.

## Goal

Repair ten reported performance-script references while preserving the historical
verification outcomes in five existing plans.

## Scope

Replace the two performance references in each of the 760 preview deploy guard,
779 footer date rework, 781 public refresh releases, 824e rollback follow-up, and
Astro acceptance baseline plans with relative Markdown links to maintained files.
Keep recorded failures explicitly historical and preserve measurements, versions,
limits, executable instructions, and unrelated text.

## Exclusions

No checker, test, allowlist, runtime, dependency, lockfile, workflow, or deployment
changes. No application builds, browser work, external data access, branch
changes, pushes, merges, deployments, or pull request creation.

## Acceptance

- Reproduce all ten reference failures on the required base after frozen installs.
- Independently resolve every replacement link and confirm its target exists.
- Run the full documentation lint chain and record each stage and its result.
- Confirm all other tracked files are byte-identical to the base, and check the
  final diff for whitespace errors.
- Commit only these five corrected records and this plan on the current branch.
- Retain original files, diagnostics, ten mappings, and verification logs outside
  the repository. Full offline static checks and both fixture build modes remain
  for the independent reviewer.
