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

## Recorded verification

- Exact merged integration commit: `6364666f7dfdb6e92378561a511ab7f1e3f9f6d2`.
  It contains PRs #728 and #729.
- Official archive checks and runtime version checks passed. The complete
  isolated static gate passed: pipeline 205 passed, web 2,026 passed with
  49 intentional offline skips and zero failures; coverage was 89.84% lines
  and 90.38% functions. Documentation tests passed 44 checks. Lint had zero
  errors and 14 existing warnings; all three typechecks passed.
- Both fixture modes built and validated with 234 routes and 467 artifacts.
  The real preview build and matching host validation passed with 293 routes
  and 585 artifacts. No fixture override entered the deployable build.
- The complete generated preview configuration was printed and reviewed.
  Its SHA-256 was
  `1a6e0038909bcb4b1d33a620b2723aacf3509e2a74c9d6fb779dab3bf0a0e0de`.
  Preview resource bindings, noindex, three schedules and removed flags match
  the brief. Local production configuration has no scheduled triggers.
- The pinned cf object upload command exposes no conditional write headers.
  The existing publication lease requires atomic ETag compare-and-set, and
  immutable staging requires create-only writes. An unconditional upload is
  not an acceptable replacement. See the official
  [object upload API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/upload/).
  No unsupported write transport has been implemented.
- Deployment succeeded at 23:19:18 UTC on 2026-10-21. Version
  `2a7ad7b8-7bd4-41eb-aaa9-3c09af609999` receives 100% of preview traffic;
  deployment `68a6a2ec-1fa6-4dc8-93f2-31e9c3112ef7` and the public deployment
  identity confirm the exact tested commit. Post-deployment artifact validation
  passed and the reviewed Worker configuration remained byte-identical.
- The CLI acknowledged applying all three preview schedules. The pinned CLI
  has no independent live schedule read/list operation, so no scheduled
  invocation is claimed. CRON_SECRET remains in the secret-name inventory;
  no secret values were requested.
- Source-plan counts and any resulting continuation requirement will be
  recorded on the card before temporary output is removed. This card has not
  called a cron/refresh endpoint or written an R2 data object.
