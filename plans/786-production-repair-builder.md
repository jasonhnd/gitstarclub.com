# Issue 786: offline production repair builder

## Goal

Build a complete local option B repair generation from retained inputs without
network access, remote writes, credentials, or synthesized repository identities.

## Scope

- Copy the frozen view snapshot as the base phase.
- Restore canonical monthly flows from frozen curves and recover the frozen
  anchoring factor by curve inversion; verify every monthly flow and stock.
- Recover node IDs from a retained whitelist and retained GitHub REST responses.
- Restore pre-seam weeks from local gross Parquet and merge aggregate history
  using the existing importer behavior and provenance.
- Emit both bootstrap phase manifests and an inspectable JSON report.
- Test the complete output and refusals with small local fixtures; document
  exact Mac commands in the script header, runbook, and pull request.

## Out of scope

The comparison command (parent task 3), downloads, bucket writes, rehearsals,
production changes, promotion, and deployment are separate cards.

## Acceptance

- All kept IDs have a retained node ID with a recorded source.
- Missing or synthetic identities and monthly curve inconsistencies fail closed.
- Both phases verify with the existing bootstrap manifest verifier.
- Pipeline tests, the full web coverage suite, static checks, and local builds pass.

## Execution constraints

Remain in `~/w` on `ib/gsc-786`. The owner prohibits repository copies and branch
switches, overriding the usual detached-clone verification step. Run clean
environment checks in place with all temporary files and caches under
`.kanban-work/786`, without loading environment files or opting into live tests.
