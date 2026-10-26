# Issue 824, card C: repair publication targets and guards

## Goal

Resolve only the exact preview or production bucket after checking its identity,
and format the recovery pointer command before publication can write anything.

## Scope

- Add `web/scripts/repair-publish-target.ts` beside the offline repair builder.
- Inject every Cloudflare CLI call through the requested `CfRunner` type.
- Require exact target, bucket, identity, and production confirmation values.
- Cover both allowed targets and every refusal with a recording fake runner.
- Document the module and the rollback command contract for later integration.

## Out of scope

Publisher core, CLI implementation, lease and pointer writes, real Cloudflare
access, credentials, deployments, other branches, and remote Git operations.

## Acceptance

Both happy paths pass; invalid options fail before the runner is called;
unreadable, malformed, or mismatched identity markers fail closed. Only one
identity read is allowed. Recovery commands use validated generation IDs and
carry the exact production confirmation. Pipeline tests and the complete web
coverage suite pass; run the repository static checks and local builds too.

## Execution constraints

Remain on the current branch in `~/w`. The owner's explicit prohibition on
repository copies overrides detached-clone verification. Run checks in place
with a clean environment, no environment files, and all caches and generated
artifacts under `.kanban-work/824c` where tool configuration permits. This local
card directory also replaces the suggested `$HOME/ktmp`, respecting the owner's
workspace constraint. Do not run an actual `cf` command. The later integration
card must implement the printed repair CLI command and print it before writes.
