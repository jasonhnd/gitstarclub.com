# Preview empty monthly history: issue 743

Evidence baseline: `8071b170a9564bb58668f92a4e72c92fb41a2530` (`pre`).
**Verified** means code, test, committed operational-document or public-data
read; tests were not executed. **Inferred** means a conclusion from those sources
and the card's 2026-10-25 09:00Z observations. No live mutations were made.

**Verified public reads (2026-10-25):** plain `curl -s` GETs returned HTTP 200
for the four paths below on `https://data-pre.gitstarclub.com`. A generation is
a published data snapshot; the active and previous generations are identified
by `bootstrap/latest.json`.

| Public path | Observed body fields |
| --- | --- |
| [bootstrap/latest.json](https://data-pre.gitstarclub.com/bootstrap/latest.json) | `generation`: `bootstrap-aggregate-gap-20261022T001946Z`; `previous_generation`: `bootstrap-aggregate-recovery-8adece3468c17fa8`; `published_at`: `2026-10-22T12:49:05.410Z`. |
| [views/latest.json](https://data-pre.gitstarclub.com/views/latest.json) | `version` and `run_id`: `refresh-2026-10-21T21-01-25-223Z`; `published_at`: `2026-10-21T22:08:08.586Z`; `prev_version`: `null`; `schema_ver`: `1`. |
| [canonical/v2/meta.json](https://data-pre.gitstarclub.com/canonical/v2/meta.json) | `{"seam_date":"2026-10-21","schema_ver":2,"folded_through":{"month":"2026-09","week":"2026-W40"},"generated_at":"2026-10-21T13:50:06.021Z"}`. |
| [ops/workflows/health/workflow-refresh.json](https://data-pre.gitstarclub.com/ops/workflows/health/workflow-refresh.json) | `status`: `failed`; `at`: `2026-10-25T06:02:05.272Z`; `run_id`: `refresh-2026-10-25T06-01-12-515Z`; `error`: `canonical preflight failed (1): canonical/v2/repo-monthly: no repository records for 5669 canonical repo(s)`. |

**Verified:** the [sealed active-generation metadata](https://data-pre.gitstarclub.com/bootstrap/generations/bootstrap-aggregate-gap-20261022T001946Z/canonical/v2/meta.json)
(the immutable seed) returns the same body as the flat metadata above. Its
[overlay metadata](https://data-pre.gitstarclub.com/bootstrap/overlays/bootstrap-aggregate-gap-20261022T001946Z/canonical/v2/meta.json)
(mutable updates) is absent, HTTP 404. Under each generation's
`bootstrap/generations/<generation>/canonical/v2/` prefix, sampled monthly
files have these bodies:

| Sealed generation | `repo-monthly/0.json` | `repo-monthly/1.json` | `repo-monthly/7.json` |
| --- | --- | --- | --- |
| [Active: bootstrap-aggregate-gap-20261022T001946Z](https://data-pre.gitstarclub.com/bootstrap/generations/bootstrap-aggregate-gap-20261022T001946Z/canonical/v2/repo-monthly/0.json) | `{}` | `{}` | `{}` |
| [Recovery: bootstrap-aggregate-recovery-8adece3468c17fa8](https://data-pre.gitstarclub.com/bootstrap/generations/bootstrap-aggregate-recovery-8adece3468c17fa8/canonical/v2/repo-monthly/0.json) | `{}` | `{}` | `{}` |

The active overlay and flat `canonical/v2/repo-monthly` paths for buckets
(file groups) 0, 1 and 7 return HTTP 404. The active sealed `repo-weekly` and
`repo-recent-daily` files in those same buckets contain repository keys.
These October 22 snapshots already contain empty monthly history, so the
emptiness predates Sunday's failure and is directly read, not merely inferred
from that failure.

**Verified conclusion:** monthly history was never populated, rather than lost
by Sunday's weekly job. Cold start intentionally published without archive
history; the aggregate import retained that state. Removing the initialization
exceptions exposed an unsupported transition to strict steady-state validation.

## 1. Who writes monthly, and did cold start skip it?

**Verified:** the historical bootstrap exporter (the initial archive-data loader)
aggregates daily archive rows by month and emits all 32 monthly files.
`BACKFILL_BUCKETS` defines 32 in
[backfill-data.mjs:4](../../pipeline/lib/backfill-data.mjs#L4); `writeBucketSeries`
writes every bucket in
[07-export-v2.mjs:175–177](../../pipeline/backfill/07-export-v2.mjs#L175).
The exporter header states `id % 32` (the repository ID's remainder after
division by 32), and the monthly aggregation calls that writer:
[07-export-v2.mjs:5–8](../../pipeline/backfill/07-export-v2.mjs#L5),
[pipeline/backfill/07-export-v2.mjs:199–220](../../pipeline/backfill/07-export-v2.mjs#L199).
The recurring writer is managed refresh's **fold**, which moves closed months'
frozen net star changes into canonical history:
[fold.ts:193–264](../../web/lib/workflows/steps/fold.ts#L193),
[fold.ts:309–320](../../web/lib/workflows/steps/fold.ts#L309), and
[fold.ts:580–619](../../web/lib/workflows/steps/fold.ts#L580).
Its `readPending` at [fold.ts:328](../../web/lib/workflows/steps/fold.ts#L328) calls
`readPendingForFold` at [fold.ts:332–338](../../web/lib/workflows/steps/fold.ts#L332),
which reads only `canonical/v2/pending/<month>.json`, not imported daily history.
The documented handoff states the same:
[VERCEL-DATA-OPERATIONS.md:389](../VERCEL-DATA-OPERATIONS.md#L389).
Neither the weekly cron nor the aggregate importer creates monthly observations.

**Verified:** cold start writes minimal metadata with the start day as
`seam_date` (the boundary between archive history and observed net changes), and
`folded_through.month` (the completed-month watermark) set to the previous month:
[cold-start.ts:48–60,91–105](../../web/lib/workflows/cold-start.ts#L48).
[OPS.md:490–494](../OPS.md#L490) explicitly records the 2026-10-21 run as a
rehearsal with no archive history and initially empty monthly/weekly series.
The full-chain test expects publication with an empty monthly curve:
[full-chain-cold-start.test.ts:72–90](../../web/lib/workflows/runtime/full-chain-cold-start.test.ts#L72).

**Inferred:** with September already marked completed and October still open on
both October 21 and 25, the fold has no eligible month. That is intentional;
[fold.ts:193–207](../../web/lib/workflows/steps/fold.ts#L193) and
[fold-step.test.ts:340–360](../../web/lib/workflows/steps/fold-step.test.ts#L340)
confirm this no-op. The watermark does not prove September rows ever existed.

## 2. What did the aggregate import write, and how does it reach canonical?

**Verified:** it adds daily/weekly observations, preserves existing monthly
bytes, and materializes `{}` for absent monthly files. It does not synthesize
monthly totals:
[aggregate-history-import.ts:146–187](../../web/scripts/lib/aggregate-history-import.ts#L146).
The cold-start import test explicitly expects `{}` in the new generation while
the old flat monthly file remains absent:
[aggregate-history-import.test.ts:169–188](../../web/lib/aggregate-history-import.test.ts#L169).
This follows the owner policy in
[STAR-HISTORY-AGGREGATE.md:145–173](STAR-HISTORY-AGGREGATE.md#L145):
aggregate surviving-star counts must not become monthly net history or stocks.

**Verified:** committed execution evidence records publication of
`bootstrap-aggregate-gap-20261022T001946Z`, with 5,238 repositories imported,
649,512 daily additions and 89,046 weekly additions:
[preview-aggregate-import-evidence.json:406–420,451–457](preview-aggregate-import-evidence.json#L406).
The [sealed import report](https://data-pre.gitstarclub.com/bootstrap/generations/bootstrap-aggregate-gap-20261022T001946Z/views/aggregate-history-import.json),
independently read on 2026-10-25, confirms `repositories_imported: 5238`,
`daily_added: 649512` and `weekly_added: 89046`.

**Verified:** publication stages a complete snapshot and commits its pointer,
a small JSON file selecting the active generation:
[aggregate-history-import.ts:320–330](../../web/scripts/lib/aggregate-history-import.ts#L320).
There is no later copy into flat `canonical/v2`. Logical canonical reads consult
`bootstrap/latest.json`, then try `bootstrap/overlays/<generation>/canonical/...`
(the mutable updates), followed by `bootstrap/generations/<generation>/canonical/...`
(the sealed seed); writes target the overlay:
[bootstrap-publication.ts:149–168](../../web/lib/data/bootstrap-publication.ts#L149),
[source.ts:569–593](../../web/lib/data/source.ts#L569),
[write.ts:8–14](../../web/lib/data/write.ts#L8).
[VERCEL-DATA-OPERATIONS.md:453–471](../VERCEL-DATA-OPERATIONS.md#L453)
documents this design. A flat-path GET alone cannot establish active contents;
`views/latest.json` being unchanged does not mean canonical import is unpublished.

## 3. Should Sunday's 04:00 weekly cron have filled it?

**Verified:** no. The 04:00 job updates the live layer; the distinct 06:00 job
runs managed refresh:
[OPS.md:350–356](../OPS.md#L350),
[cron-dispatch.ts:4–12,53–60](../../workers/gitstarclub-web/src/cron-dispatch.ts#L4).
Weekly/daily refresh publishes current-month state, rankings and heatmap; it
freezes a pending month only when the month rolls over:
[live-refresh.ts:190–199,283–310](../../web/lib/cron/live-refresh.ts#L190).
It never writes `repo-monthly`. **Inferred:** October 25 required no October
closeout, so the reported weekly success is consistent with empty canonical
monthly history. There is no evidence here of a missed monthly write.

## 4. Legitimate empty state or missing data?

**Verified:** empty monthly history is legitimate for this rehearsal's seed;
the importer explicitly supports preserving it. Current strict validation,
however, deliberately rejects it: repository-key counts are summed across all
buckets, and zero monthly keys triggers the failure regardless of history age:
[canonical-validation.ts:160–196,271](../../web/lib/workflows/canonical-validation.ts#L160).
This counts repository keys, not observation tuples. Adding empty arrays under
repository keys could evade that check without supplying history.
The test asserts strict rejection:
[canonical-validation.test.ts:57–73](../../web/lib/workflows/canonical-validation.test.ts#L57).

**Inferred:** this is a lifecycle-policy gap, not evidence of deleted data.
The check is too strict for continuing this intentionally history-free preview,
but accurately enforces the current documented steady-state contract. Historical
monthly observations are absent; they were never promised by the import.

**Verified:** waiting or retrying alone is insufficient: preflight rejects before
fold in the actual job graph
[graph.ts:79–92](../../web/lib/workflows/runtime/graph.ts#L79), and its final window
rejects empty families in [preflight.ts:108–109](../../web/lib/workflows/steps/preflight.ts#L108).
There are later blockers too: final canonical validation repeats the family
check; sampled empty monthly curves and a missing prior-year heatmap also block
ordinary publication:
[canonical-validation.ts:338–343](../../web/lib/workflows/canonical-validation.ts#L338),
[validate.ts:133–137,219–247](../../web/lib/workflows/steps/validate.ts#L133).
[OPS.md:494](../OPS.md#L494) explicitly warns of later history failures.
**Inferred:** bypassing only preflight would move the failure downstream.

## 5. Proposed follow-up cards

**Inferred recommendation:** retain honest empty history and add narrowly scoped
support for this preview lifecycle. Tech must review that policy. Restoring the
old broad flags or inventing monthly zeros is not a complete repair. Proposed
cards below are not implemented; code estimates exclude full-suite/build time.

| Follow-up card | Size | Risk and acceptance |
| --- | --- | --- |
| A. Identify intentionally absent preview history | Code 15 min | Medium: define an explicit preview-only history-availability marker and validated reader with default strict behavior; record the seed date and absent monthly/prior-year coverage. Cover production rejection and malformed/missing marker. Do not infer eligibility solely from an empty family or a watermark. |
| B. Apply that policy to canonical completeness | Code 15 min; depends on A | Medium: allow zero monthly keys only under A in both windowed preflight and final canonical validation. Retain required-file, schema, identity, orphan, weekly/daily and production checks. Cover eligible and strict cases; update completeness docs. |
| C. Apply that policy to publication history gates | Code 15 min; depends on A | Medium: scope the sampled empty monthly curve and absent prior-year heatmap exceptions to declared unavailable coverage; malformed or unexpectedly missing data still fails. Add regression coverage and update OPS. |
| D. Verify the steady-state transition offline | Test-code 15 min; depends on B/C | Low: extend the in-memory chain to first publish, aggregate import, flags removed, and second refresh; cover month rollover and restored strictness when history becomes available. Run the full web suite and required gates; allow 30–60 min for execution. |
| E. Deploy and recover preview | **Mac deploy/data**, 30–60 min plus refresh runtime; depends on reviewed A–D | Medium: separately authorize preview deployment and marker initialization after verifying active-generation provenance/coverage, then one managed refresh outside cron overlap. Verify all gates, pointers, unchanged monthly observations, imported daily/weekly history and health. No production operation. |

**Inferred alternative:** if Tech requires the existing strict historical contract,
use a separate **Mac data investigation/backfill card** (investigation 30–60 min;
execution size unknown until a source is reviewed). It must identify an approved
monthly-history source and required prior-year site history, validate a complete
snapshot and publish through the normal generation protocol. The aggregate export
is explicitly ineligible for deriving those monthly values. That alternative is
larger than supporting the documented rehearsal and is not authorized here.
