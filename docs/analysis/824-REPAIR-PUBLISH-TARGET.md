---
owner: data
status: active
last_reviewed: 2026-10-26
source_of_truth_for:
  - issue 824 card C repair publication target guard contract
---

# Issue 824-C: repair publication target contract

`web/scripts/repair-publish-target.ts` is a self-contained guard beside the
#786 offline builder. It has no default runner, environment reads, process
spawning, or writes. Tests inject a fake `cf` (the Cloudflare command-line tool)
that records arguments and returns the identity marker's body as stdout.

`resolvePublishTarget({ target, bucket, generation, confirmProduction }, runner)`
returns `{ target, bucket, generation }` only when all checks pass:

| Target | Exact bucket | Identity fields | Confirmation |
| --- | --- | --- | --- |
| `pre` | `gitstarclub-data-pre` | `bucket` equals the bucket, `deploy_env` equals `pre` | `confirmProduction` must be absent |
| `production` | `gitstarclub-data-prod` | `bucket` equals the bucket, `deploy_env` equals `production` | Exactly `publish <generation> to gitstarclub-data-prod` |

Generation IDs follow the existing bootstrap validator. Local option failures
make no runner calls. Identity validation makes exactly one read:
`cf r2 objects get _meta/bucket-identity.json --bucket-name <bucket> --text`.
The argument format and raw text output follow the installed, pinned
`cf@1.0.0-beta.18` implementation. A failed read, nonzero command exit, invalid
JSON, or mismatched identity throws an error. The integrating CLI must report
that error, exit nonzero, and never continue to writes. No identity fallback or
identity creation is allowed.

`formatRollbackCommand(target, recoveryGenerationId)` returns these exact
repository-root command forms, using a validated recovery generation ID:

```bash
bun --no-env-file web/scripts/repair-publish.ts --target pre --bucket gitstarclub-data-pre --rollback bootstrap-recovery-824
bun --no-env-file web/scripts/repair-publish.ts --target production --bucket gitstarclub-data-prod --rollback bootstrap-recovery-824 --confirm-production "publish bootstrap-recovery-824 to gitstarclub-data-prod"
```

These are the **later integration card's command contract**. This card does not
create `repair-publish.ts`; these commands are not runnable yet. That card must
implement `--rollback` as a guarded, lease-protected swap of
`bootstrap/latest.json` to the verified recovery generation, using the existing
bootstrap rollback logic. A lease is the shared writer lock that excludes other
publishers. Rollback confirmation names the recovery generation, not the repair
generation. Do not use the older S3-credential CLI or a raw pointer upload.

The integrating CLI must call the resolver, then format and print the rollback
command **before any write**, including recovery uploads and lease acquisition.
It must stop if either helper throws. Printing order belongs to that CLI and is
not enforced by this read-only module. Fake-runner tests exercise all refusals
and both allowed targets; they never invoke the real Cloudflare executable.
