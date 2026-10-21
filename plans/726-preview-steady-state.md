# Preview steady-state scheduling (#726)

## Goal

Run the established refresh jobs automatically on preview Worker
`gitstarclub-web-pre` after its first managed publication. GSC_0100 published
`refresh-2026-10-21T21-01-25-223Z` and initialized the separate live generation.
Production scheduling remains disabled pending owner authorization.

## Scope

- Update mode `pre` in the typed Worker configuration and its public variable
  source, `web/host-contract.mjs`. Remove `WORKFLOW_COLD_START` and
  `PREFLIGHT_RELAX_EMPTY_SHARDS` from preview only.
- Configure daily live refresh at `0 3 * * *`, Sunday live refresh at
  `0 4 * * SUN`, and managed refresh at `0 6 * * SUN`, all UTC. The weekly live
  job is necessary because the daily handler deliberately skips Sunday.
- Keep the configuration gate strict, update its preview expectations, and cover
  missing/unexpected schedules and reintroduced first-publication flags.
- Update the existing Worker-entry configuration regression test to connect the
  enabled preview schedules to the supported dispatch plans, retaining the
  assertion that production has no scheduled jobs.
- Confirm the existing dispatcher maps these schedules to daily, weekly, and
  managed-refresh handlers. Update `docs/OPS.md` with the new configuration and
  the separate post-merge deployment procedure.

## Out of scope

No production Worker, bucket, queue, variable, or schedule changes. No merge,
protected-branch push, force push, shared-branch rebase, secret rotation, DNS or
route change, manual R2 object edits, coverage expansion, CI/delivery changes,
Wrangler/OpenNext execution, or additional managed `/start` call. The current
submission does not deploy or call preview cron endpoints.

## Steps

1. Read GSC_0100, the operations runbook, and repository policies; bootstrap the
   checksum-verified pinned runtimes and install frozen web/pipeline dependencies.
2. Implement the preview configuration and gate expectations, preserving the
   production contract. Update the runbook and commit each completed step.
3. Run the complete offline AGENTS gate on the exact head in a fresh detached
   shared clone. Build and validate production and pre using the local fixture.
   Keep GitHub Actions off and skip `cf:dry-run` by owner order.
4. Push only this card branch and open one PR against `pre` with `Closes #726`,
   commands, results, and limitations. Submit to independent review with
   `waitingOn: PR merge`; do not merge.
5. After the leader resumes this card following merge, freshly build the exact
   merged head with the real pre source and validate mode `pre`. Inspect the
   generated Worker, bindings, schedules, absent flags, and `SITE_INDEXABLE=0`.
   Deploy using pinned `bun run deploy:pre --skip-build`; read back deployment
   identity/version, schedules where supported, and retained `CRON_SECRET` name.
   Make the single authorized daily request with the designated secret passed
   through a stdin header, then verify the advanced live generation and English
   and Japanese home/repository data. Leave the next managed run to its cron.

## Acceptance

- Preview has exactly the three documented schedules; production has no scheduled
  triggers and its public variables are unchanged.
- Neither first-publication flag is present on preview, and the gate rejects its
  reintroduction. Existing dispatch tests cover every configured expression.
- The exact PR head passes the complete static job, full web coverage thresholds,
  and both fixture builds with matching host validation. Record all commands and
  results in the PR and handoff; no owner environment files enter verification.
- A reviewer using a model different from executor `gpt-6.1-sol` receives the PR.
  The later resumed phase reports merged SHA, deployed version, schedule readback
  or an explicit tool limitation, and the daily generation id.
- Remove the verification clone, dependencies, logs, and build output when no
  longer needed; leave a clean working tree and report card-directory disk usage.

## Known limitation

The preview publication is a rehearsal dataset without historical backfill.
Later managed refreshes use normal strict validation and may reject missing
historical panels. This task does not relax validation or fabricate history.
