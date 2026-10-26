# Issue #833: production-layout repair rehearsal

## Goal

Allow the repair publisher to rehearse production publication in the private
`gitstarclub-data-rehearsal` bucket with the same recovery, commit, and rollback
checks.

## Scope

- Add the exact rehearsal target/bucket/identity pair and typed confirmation.
- Reuse the existing `--confirm-production` option with the rehearsal phrase.
- Run the production command scenarios against the rehearsal fake bucket,
  including its pointer-free starting state, refusal paths, dry-run, and rollback.
- Document rehearsal before production and why preview is unsuitable, leaving
  the concurrently edited rollback paragraph untouched.

## Out of scope

Bucket access or creation, credentials, deployment, branch changes, and changes
to existing pre/production publication behavior or recovery sources.

## Acceptance

- All mixed target/bucket pairs refuse before any cf runner call.
- Rehearsal requires `rehearse <generation> in gitstarclub-data-rehearsal`,
  including dry-run and the printed executable rollback command.
- Existing production scenarios also pass for rehearsal without target-specific
  exceptions in the publication code.
- Run the requested frozen installs, pipeline tests, and full web coverage suite,
  plus applicable static checks. Verify in place because this card explicitly
  forbids copying the repository or switching branches.
