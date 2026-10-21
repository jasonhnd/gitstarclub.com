# GSC_0154 preview activation and aggregate history import

## Goal

Activate preview steady-state schedules on the merged integration commit and
repair the retained aggregate star-history gap without changing production.

## Scope

1. Verify the exact current `origin/pre` in one clean detached shared clone with
   the complete AGENTS static gate and both fixture builds.
2. Build again from the real preview read source, validate and review the
   generated preview-only Worker contract, then deploy with the pinned adapter.
   Record the deployed commit, version, secret names and schedule-read limits.
3. Validate the sealed source read-only and inspect the import plan. Use the
   existing authenticated pinned cf object interface without new credentials.
   If needed, deliver one minimal preview-locked transport PR preserving the
   importer's conditional writer lease, then hand off pending its merge.
4. Only after a supported transport is merged, execute the authorized importer,
   verify publication and three repositories in English and Japanese, then
   issue the one authorized preview daily GET after checking the writer lease.

## Out of scope

Production resources, protected branch pushes, PR merges, credential changes,
DNS/routes, direct pointer repair, private manifest uploads, coverage expansion,
Wrangler/OpenNext commands, enabling Actions and managed refresh start calls.

## Acceptance

- Exact merged preview commit passes the full isolated local gate and real
  preview build; generated bindings, indexing and schedules match the brief.
- Deployment identity matches that commit, its version receives all traffic,
  and the CRON_SECRET name remains present without reading its value.
- Import uses the existing fenced immutable publication path and preview bucket
  identity guard. A missing CLI capability fails closed without remote writes.
- Record actual imported/skipped counts, generation and page evidence only
  after publication; preserve unavailable sources as unknown.
- If a transport PR is required, include the complete exact-head local gate in
  its body and return it for independent review with `waitingOn: PR merge`.
- Commit completed source steps, keep the card branch clean, remove temporary
  verification copies promptly, and record final temporary-directory size.

## Verification environment

Use Node 24.20.0 and Bun 1.4.2 after official archive checksum verification.
Keep the owner-approved shared toolchain cache and Bun install cache, retain
HOME, and leave BUN_INSTALL_CACHE_DIR unset. All other temporary artifacts stay
under this card's excluded `.kanban-work/GSC_0154` directory. Skip cf:dry-run by
owner order. GitHub Actions remains disabled.
