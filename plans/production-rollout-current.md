# Current production rollout plan

Status: plan for Jason's decision, checked 2026-10-20. This document authorizes no production action.

## Goal, scope and acceptance

Prepare an explicitly approved release from `pre` to `main`, then deploy the tested code,
repair and publish production data, and separately enable the approved weekly schedule.
Scope is the sequence, evidence, rollback target and decisions below; this PR changes only a plan.
Acceptance for this PR is `bun run lint:docs`, clean `git diff --check`, and the pushed PR head matching the tested commit.
No promotion, merge, deployment, refresh, schedule, secret, DNS, object write or reader-facing copy change is in scope here.
Never push directly to protected branches, force-push, or enable GitHub Actions.

## Current source and live baseline

Source snapshot: fetched `origin/pre` = `001b9cb6806b1bdb58970889d2265af1425dd109`;
`origin/main` = `99cb00e7c70cd3d368f7caeea1435b211d46d707`. Re-fetch before requesting approval; neither is a permanent release selection.
The source host is vinext (the Vite-based application adapter) on Cloudflare Workers,
using cf (the Cloudflare command-line tool), pinned to `1.0.0-beta.18`.
[web/package.json](../web/package.json) pins vinext `1.2.1` and `@vinext/cloudflare` `1.1.1`;
`deploy:pre` invokes `vinext-cloudflare deploy --env pre` through cf.
There is **no production deploy script**. A separately reviewed, mode-explicit production adapter/cf path is needed before launch.
Wrangler and OpenNext have been removed from the current host and are banned by owner order; do not revive their commands or a Cloudflare dry run.
The replacement is the local, non-deploying gate below, per [AGENTS.md](../AGENTS.md) and [VINEXT-HOST.md](../docs/VINEXT-HOST.md).

Read-only cf deployment/version queries and public `/.well-known/deployment` GETs confirmed:

| Surface | Observed state on 2026-10-20 |
| --- | --- |
| Production `gitstarclub-web` | 100% on version `9b4dedf3-6c33-42b2-a552-23bc09869bb7`, deployment `3ec650e0-9a5b-4666-9bed-329856e0a472`; commit `daee5fc2ee35a62963ec8eb02cc566f30ed83964` |
| Preview `gitstarclub-web-pre` | 100% on version `0da6aba9-dd15-4ba5-9180-602b6fd2e1e3`; public commit `c00335f9c3fa27ce9b08c959083f40495345ddde` (vinext host migration) |
| Production data | R2 (Cloudflare object storage) `DATA` binding = `gitstarclub-data-prod`; read driver `r2`, write driver `r2_binding`, origin `https://data.gitstarclub.com` |
| Frozen production generation | Live `VIEWS_VERSION_FALLBACK=refresh-2026-09-13T06-00-16-398Z`; production `views/latest.json` and `bootstrap/latest.json` both return 404 |
| Preview first publication | `WORKFLOW_COLD_START=1`, separate `gitstarclub-data-pre`; its views pointer returns 404, consistent with awaiting the first cold-start refresh |
| Cron triggers (scheduled invocations) | Both live Workers return `schedules: []`; checked-in typed configuration also declares no cron triggers |

Evidence: `cf workers deployments list --worker <name>`, then `cf workers versions get <id> --worker-id <name>`;
production version metadata also names `daee5fc`. The pinned CLI has no schedule-list command:
its authenticated GET transport read each Worker's schedules endpoint,
using the [schedule GET contract](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/schedules/methods/get/).
No credential values were printed or copied. Deployment identity is distinct from the Git branch head.
Target bindings, fallback and indexing policy are in [web/host-contract.mjs](../web/host-contract.mjs)
and [web/cloudflare.config.ts](../web/cloudflare.config.ts); a source contract does not deploy itself.

## Runbooks and data repair prerequisites

[R2-CUTOVER.md](../docs/R2-CUTOVER.md) records the accepted October 4 storage cutover;
stage 5 (production schedules) and stage 6 (retained Blob-store retirement) remain unaccepted.
[OPS.md](../docs/OPS.md#managed-refresh-runbook) owns refresh, publication and data rollback.
The plan merged in [PR #667](https://github.com/jasonhnd/gitstarclub.com/pull/667),
[prod-rollout-and-data-repair.md](prod-rollout-and-data-repair.md), preserves the canonical-shard/fold-gap diagnosis.
Its old host commands, preview identity, collection status and historical rollback recipes are superseded here and by VINEXT-HOST.md.
Do not use its GH Archive proposal, old platform tooling or old Blob-backed Worker rollback target.

Repair only the **2026-05-30 through 2026-09-30 daily/weekly gap** with GitHub aggregate star history,
per [STAR-HISTORY-AGGREGATE.md](../docs/analysis/STAR-HISTORY-AGGREGATE.md), merged [PR #685](https://github.com/jasonhnd/gitstarclub.com/pull/685)
and [PR #688](https://github.com/jasonhnd/gitstarclub.com/pull/688). These are surviving stars at collection time,
with GitHub calendar labels, zero date shift and no guaranteed UTC boundary; they are not historical net growth.
Monthly totals, monthly rankings, frozen series and stock anchors must remain exactly as published.
The completed collection has 5,243 complete repositories and six unavailable out of 5,249; missing counts are unknown, never zero.
Join partial ISO weeks at the gap edges to adjacent observations; never replace a complete week with a partial sum.
The collector does not implement an approved production publisher. Separately review integration and preview evidence.
Reader-visible source/approximation labels are in [PR #690](https://github.com/jasonhnd/gitstarclub.com/pull/690), still OPEN at this check;
do not publish repaired pages until that dependency and provenance propagation are accepted.

Raw inputs remain private in `gitstarclub-raw`, separate from both public data buckets.
Read-only cf listing confirmed `backups/2026-10-20/` contains `raw-backfill.tar.gz`, `star-history-agg.tar.gz`,
their SHA-256 manifests and `README.txt`; managed public access is disabled and custom domains are empty.
The backup README excludes two aggregate manifests containing local paths: do not assume a self-contained publish bundle.
Verify restored files and source provenance before integration; this plan did not download or checksum the archives.
See [OPS raw-data inventory](../docs/OPS.md#raw-backfill-data) and the original [raw-data manifest](../docs/raw-data.sha256).

## Authorized rollout sequence

Each production write below requires the corresponding explicit owner approval; approval of this plan alone grants none.

1. **Select and test the release.** First land the separately reviewed production deploy entry point on `pre`.
   Record the current `pre` head and included PRs, resolve the data-label dependency,
   and obtain preview cold-start/publish evidence under [OPS](../docs/OPS.md#preview-cold-start-first-run-one-time-662).
   Preview rehearsal data is not a production baseline. Keep the 10,000-star floor and production cold-start flags off.
2. **Run the local gate on the exact candidate.** Use a fresh detached shared clone under the active card's temporary directory.
   Run the checksum-verified AGENTS.md bootstrap (Node `24.20.0`, Bun `1.4.2`) and its full offline static/build block:
   installs/audits, pipeline tests, docs/web lint, three typechecks, view/graph validation and the full web coverage suite.
   With its local read-only fixture, run `build:production` plus `validate:host -- --mode production`,
   then `build:pre` plus `validate:host -- --mode pre`. Record results; there is no deployment dry-run gate.
3. **Promote only after Jason's explicit words:** "push main", "push to main", or "promote to main".
   Only then open a separate `pre` -> `main` PR; the authorized reviewer/owner uses a **merge commit**, never squash,
   per [.grok/rules/pre-only.md](../.grok/rules/pre-only.md). Reconfirm the approved head; test the exact resulting release commit before deployment.
4. **Prepare the production artifact and deploy path.** Confirm the reviewed adapter/cf entry point from step 1
   explicitly selects mode `production` and Worker `gitstarclub-web`.
   Rebuild with `bun run build:production` and validate with `bun run validate:host -- --mode production` from `web/`.
   Use the real production R2 origin and preserved fallback, with fixture/Blob overrides absent; never deploy fixture artifacts.
   Review the full generated config, binding isolation, platform-managed secrets, cache binding, URLs and absent schedules;
   record the artifact commit and current rollback version. Follow [VINEXT-HOST.md](../docs/VINEXT-HOST.md#configuration-and-commands).
5. **Deploy code under separate authorization.** The authorized operator uses the reviewed `@vinext/cloudflare` deploy/cf path
   for `gitstarclub-web`, records the new version and traffic split, and verifies the public commit and initial smoke checks below.
   Code deployment alone neither repairs data nor authorizes a refresh or schedule.
6. **Repair and first production refresh under separate data-write authorization.** Validate canonical completeness and missing
   pending/fold inputs identified in PR #667, preserve monthly values, and accept preview repair/provenance evidence first.
   Stage and verify the reviewed production data inputs in `gitstarclub-data-prod`; do not copy the preview rehearsal baseline
   or use empty-bucket cleanup/production cold start. The operator follows OPS's guarded managed-refresh and publication protocol,
   using production `DATA` and Queue (background job delivery) bindings. Require a published manifest, valid authoritative pointers, validation evidence,
   health success and matching rendered data. Preserve the fallback until pointer acceptance permits a separately reviewed removal.
7. **Enable the approved weekly cron only after first-refresh acceptance.** Stage 5 is a separate owner-approved config/gate
   change via a reviewed `pre` PR and explicitly approved promotion, then platform scheduling through cf.
   OPS distinguishes weekly live overlay `0 4 * * SUN` from managed weekly refresh
   `0 6 * * SUN`; have Jason select the intended job(s), then verify actual schedules and the first successful health record.
   Do not silently enable daily or preview schedules, and do not treat a manual refresh as scheduler evidence.

## Smoke acceptance and rollback

Check after code deployment and again after data publication: English `/` and Japanese `/ja/`, `/rankings` plus an available
period from the sitemap, and representative canonical repository pages in both locales must return populated, correct content.
Check `/api/lang?lang=ja&next=/` redirects and persists locale selection, then switch back to English.
Production `/robots.txt` and page robots metadata must be indexable; preview stays noindex.
CSP (Content Security Policy, the browser's allowed-source rules) must retain `script-src 'self' 'unsafe-inline'`,
per [web/lib/csp.ts](../web/lib/csp.ts); check language links against [LanguageSwitcher.tsx](../web/app/components/LanguageSwitcher.tsx).
Compare commit, generation, rows/counts, source labels and monthly totals with the accepted baseline; HTTP 200 alone is insufficient.

The exact pre-launch Worker rollback target is **`9b4dedf3-6c33-42b2-a552-23bc09869bb7` / `daee5fc2ee35a62963ec8eb02cc566f30ed83964`**.
Reconfirm availability/configuration before launch. Under rollback authorization, use cf to route 100% to this previous version:

```bash
cf workers deployments create --worker gitstarclub-web --strategy percentage \
  --versions '[{"version_id":"9b4dedf3-6c33-42b2-a552-23bc09869bb7","percentage":100}]'
```

This is a future rollback write, not a command run by this PR. Do not bypass deployment safety checks.
Worker rollback leaves data pointers unchanged; it cannot undo a bad data publication or schedule activation.
If data has changed, follow OPS's separately authorized, lease-protected pointer rollback first, then the matching Worker rollback.
Record the result and repeat smoke checks; never substitute the historical `14b84f73` or `c163a860` cutover versions.

## Decisions for Jason before launch

- Which exact tested release commit is approved, and does he explicitly authorize the promotion PR and merge commit?
- Does he separately approve the production adapter/cf entry point, deployment window, operator and rollback trigger?
- Does he accept the aggregate-source limits, six unavailable repositories, page labels and reviewed repair/first-refresh procedure?
- After first-refresh acceptance, which weekly job(s) may be enabled, by whom, and what first-run evidence is required?
- Should fallback removal follow a later accepted pointer check? Stage 6 retirement remains a separate decision.
