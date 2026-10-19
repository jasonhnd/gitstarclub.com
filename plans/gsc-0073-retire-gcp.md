# GSC_0073: Retire GCP and document the raw archive

## Goal

Make the documentation match GSC_0071: private R2 `gitstarclub-raw` is the only retained raw-data store, and GCP project `gitstarclub` entered deletion on 2026-10-19. Retire the BigQuery / GH Archive extraction source in favor of GitHub's own star history under owner decision d1019-001344-1.

## Scope

1. Install dependencies with the verified Node v24.20.0 / Bun 1.4.2 bootstrap. Read the predecessor handoff and check PR #667.
2. Add the raw inventory, checksum manifest, read-only `cf` verification, deletion time, and recovery deadline to OPS. Synchronize pipeline, contracts, storage, architecture, requirements, and raw-data repair references. Date historical extraction recipes without deleting them.
3. Verify the exact committed head in a fresh detached checkout under this card's temporary directory. Run the AGENTS bootstrap and static job through the fixture production `bun run build`, plus explicit `node scripts/check-docs.mjs`. Skip the final `cf:dry-run` subshell by owner order.
4. Push only this card's branch, open one PR into `pre`, and hand off to an independent reviewer with all results and overlap notes.

## Out of scope

Runtime code, schemas, new data coverage (lock-002), new collection or publication, R2 writes, GCP operations, Cloudflare settings/secrets/schedules, CI and delivery configuration, deploys, cron/refresh calls, and all Wrangler/OpenNext commands. Do not merge or push to `main`, `pre`, or `preview`. GitHub Actions stays off.

## Acceptance

- Current raw locations name only private R2 `gitstarclub-raw`, including the original 20 objects (30,907,971 bytes; 12,375,426 rows), whitelist (5,249 rows), and gap export (90,797 rows).
- Verification uses `cf r2 objects list/get` and `shasum -a 256 -c` against a versioned manifest; downloaded files stay under this card's `TMPDIR`.
- Project deletion request and observed `DELETE_REQUESTED` are distinguished from final purge. The recorded request is 2026-10-19T11:12:41Z; the calculated 30-day recovery deadline is 2026-11-18T11:12:41Z.
- GH Archive extraction is retired with the GSC_0045 sample caveat (~4% of the GitHub history proxy), and the replacement source is documented without authorizing a rebuild or publication.
- English-only docs pass `lint:docs` and `check-docs`; the full static job and fixture build results on the exact head are in the PR. No Wrangler command is run.
- PR includes `Closes #675`, unresolved limits, and the overlap with still-open PR #667. The executor leaves acceptance and merge to review.

## Initial findings

PR #667 was open at the start of this card. Its proposed OPS raw-data section and rollout/data-repair plan still describe a GCS primary, pending R2 copy/manifest, and a pending source decision. This card starts from `pre` and supplies the current state; the reviewer must preserve that state when reconciling #667.
