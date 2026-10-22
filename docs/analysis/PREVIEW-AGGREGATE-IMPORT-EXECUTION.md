---
owner: bootstrap pipeline
status: draft
last_reviewed: 2026-10-22
source_of_truth_for:
  - issue 736 preview aggregate import execution evidence
---

# Preview aggregate import execution evidence

Issue #736 / card GSC_0161 executes the separately authorized preview
[operator runbook](PREVIEW-AGGREGATE-IMPORT.md). The
[plan](../../plans/736-preview-aggregate-import-execution.md) defines the
scope and acceptance. This report supplies evidence to the independent
reviewer; it does not record owner acceptance.

**Current status: deployed, import running but not published.** After the
scheduled exclusion window, a fresh complete read-only plan and immediate
source/identity/idle checks passed. The exact same-generation command resumed
with token 6. The public bootstrap pointer remains absent while immutable
recovery/repaired objects are staged and verified. Counts below remain planned
until publication succeeds. The structured [execution evidence](preview-aggregate-import-evidence.json)
retains both the deliberate pause and current resume state.

## Exact deployment candidate and local gate

The fresh detached shared clone checked out exact `origin/pre`
`96b618933baadab7ebb622580c3da05efbb15f5f`, containing merged PR #734.
Remote `pre` still matched immediately before the real-source build.
No owner environment files were copied. The AGENTS heredocs ran under
`env -i` and `bash --noprofile --norc -euo pipefail`. Owner overrides used the
shared toolchain archive cache and shared HOME Bun cache, with
`BUN_INSTALL_CACHE_DIR` unset. Other output stayed under this card.

The official archive bootstrap and complete static/build block both exited
0. Every command below exited 0:

| Commands | Result |
| --- | --- |
| AGENTS archive bootstrap and static archive/version recheck | SHA-256 verified; Node v24.20.0; Bun/bunx 1.4.2 |
| `node scripts/assert-runtime-versions.mjs` | Runtime contract satisfied |
| `cd web && bun install --frozen-lockfile && bun run audit:deps && bun run validate:graph` | 587 packages audited without vulnerabilities; 683 graph nodes |
| `node scripts/assert-cf-ci-gates.mjs` | Pass |
| `cd pipeline && bun install --frozen-lockfile && bun run audit:deps && bun run test` | 42 packages audited without vulnerabilities; 205 pass, 0 fail |
| `bun run lint:docs` | Pass |
| `cd web && bun run lint` | 0 errors; 14 existing warnings |
| `cd web && bun run typecheck && bun run typecheck:tests && bun run typecheck:scripts` | All three pass |
| cd web && bun run validate:views -- scripts/fixtures/views | Pass; fixture: `web/scripts/fixtures/views` |
| `cd web && BLOB_BASE_URL=https://blob.example.com SEO_LIVE_BASE='' bun run test:cov` | 2068 pass, 49 intentional offline skips, 0 fail; lines 90.01%, functions 90.62% |
| Loopback GET/HEAD fixture: `cd web && bun run build && bun run validate:host -- --mode production && bun run build:pre && bun run validate:host -- --mode pre` | Both modes: 234 routes / 467 artifacts; exact candidate SHA; fonts, indexing and bindings valid; fixture stopped |
| `git status --short` in detached clone; lockfile checks | Empty; lockfiles unchanged |

`cf:dry-run` was skipped by owner order. No Wrangler/OpenNext command ran.
GitHub Actions readback was `enabled=false`; automation remains disabled.

## Real-source preview artifact

Under a fresh `env -i`, with no fixture override or owner environment file,
`cd web && bun run build:pre && bun run validate:host -- --mode pre` exited 0.
The real-source artifact contains 293 routes / 585 artifacts and the same
exact candidate SHA. Local fonts, indexing and bindings validate.

The complete generated `worker.config.json` was printed and inspected, then
checked with assertions:

- Worker and self-reference: `gitstarclub-web-pre`.
- DATA: `gitstarclub-data-pre`; JOBS: `gitstarclub-jobs-pre`, batch size 1,
  two retries. Existing shared MEDIA and per-Worker cache are preserved.
- `DEPLOY_ENV=pre`, `SITE_INDEXABLE=0`, R2 reads from
  `https://data-pre.gitstarclub.com`, binding writes, preview cron/queue origins.
- Exactly `0 3 * * *`, `0 4 * * SUN`, `0 6 * * SUN` scheduled triggers, only
  on pre. Production schedules remain absent from production configuration.
- No cold-start/relax flags, Blob/loopback overrides, production Worker/data/
  queue binding or inherited live-smoke setting. The existing canonical site
  URL is metadata, not a production operation target.

Before deployment, the provider still served version
`2a7ad7b8-7bd4-41eb-aaa9-3c09af609999` at 100%, with public identity
`6364666f7dfdb6e92378561a511ab7f1e3f9f6d2`. React's current canonical pages
are `/react/react` and `/ja/react/react`; both return 200 before import and
have positive current stars but no aggregate-history section. The former
`facebook/react` paths return 404 and are not the sample URLs.

## Execution progress

### Preview deployment

`cd web && bun run deploy:pre --skip-build` and the subsequent
`bun run validate:host -- --mode pre` exited 0 through pinned
`cf@1.0.0-beta.18`. The adapter packaged the real-source pages and invoked
`cf deploy --prebuilt --mode pre`; it did not invoke a legacy platform CLI.

| Readback | Value |
| --- | --- |
| Deployed commit | `96b618933baadab7ebb622580c3da05efbb15f5f` |
| Worker | `gitstarclub-web-pre` |
| Version | `5907d936-3ec4-43b1-9d0e-d5f20f45b3df` |
| Deployment | `b46ca600-d1d1-4e01-8ba8-dad20baee17c` |
| Provider creation | `2026-10-22T00:19:31.328676Z` |
| Traffic | 100% on that version, independently read with pinned cf |
| Public identity | `https://pre.gitstarclub.com/.well-known/deployment`, matching commit |
| Existing secret | `CRON_SECRET` name present; values never printed/exported |
| Generated config SHA-256 | `1a6e0038909bcb4b1d33a620b2723aacf3509e2a74c9d6fb779dab3bf0a0e0de`, identical before/after deploy |

The deployment acknowledgement lists the same three preview schedules and
preview queue producer/consumer. No schedule/DNS/route/secret change was
requested. The pinned CLI does not offer independent schedule-list readback;
this evidence is generated-config review plus the deployment acknowledgement,
not a scheduled invocation claim.

### Import preflight

At `2026-10-22T00:19:46.861Z`, the UTC cron-window guard passed.
`inspect-preview-aggregate.ts` exited 0: `active=false`; the workflow lease
is the historical released/published token 4, expired at
`2026-10-21T22:08:43.781Z`. It is not a running writer. `live/latest.json`
has `lease=null` and generation `daily-2026-10-21T23-09-32-126Z`.

The old bootstrap pointer is absent. The managed views pointer is
`refresh-2026-10-21T21-01-25-223Z`, published at
`2026-10-21T22:08:08.586Z`. The read-only plan is running for
`bootstrap-aggregate-gap-20261022T001946Z`. The read-only plan completed with
exit 0 before any execution.

### Complete read-only plan

The exact runbook command with `--target pre`, the fixed source,
`--worker-url https://pre.gitstarclub.com` and `--secret-file` returned
`status=dry-run`. The pinned manifest/65-file inventory, source membership,
124 daily labels and complete-week arithmetic passed validation.

| Result | Count |
| --- | ---: |
| Eligible repositories | 5238 |
| Skipped repositories | 441 |
| Daily additions | 649512 |
| Complete-week additions | 89046 |
| Incomplete edge joins retained as incomplete | 10476 |
| Outside the fixed source whitelist | 430 |
| Absent from preview membership | 5 |
| Source not found or inaccessible | 6 |

Every one of the 5238 import entries has 124 daily additions and 17 complete
weeks. All 10476 edge joins were checked: W22 lacks May 25-29 and W40 lacks
October 1-4. They are skipped, not published as complete weeks. Imported and
skipped ids are unique and disjoint. The complete 441-entry skipped list
matches GSC_0154 exactly, including every id, name and reason; there is no
target-plan drift. See the [complete skipped list](preview-aggregate-import-skipped.csv).
Blank names on the five absent-membership entries preserve the original
report's id-only representation.

The captured dry-run JSON SHA-256 is
`23b3b17ca6c8e147b616abd442982fa86e7badf22f1b22804ace0ce1f228c4c1`.
The completed plan confirms the three page-baseline sample selections below.

### Page baseline

Headless Google Chrome captured all six ordinary English/Japanese repository
pages before import. All returned 200 and lacked the imported-history source
note. The screenshots were inspected; the current-star cards remain positive.
The exact current-star values below are from the unchanged published lookup.

| Repository | Current stars | English page | Japanese page |
| --- | ---: | --- | --- |
| `react/react` | 251609 | `https://pre.gitstarclub.com/react/react` | `https://pre.gitstarclub.com/ja/react/react` |
| `facebook/jscodeshift` | 10040 | `https://pre.gitstarclub.com/facebook/jscodeshift` | `https://pre.gitstarclub.com/ja/facebook/jscodeshift` |
| `MSWorkers/support.996.ICU` | 10042 | `https://pre.gitstarclub.com/MSWorkers/support.996.ICU` | `https://pre.gitstarclub.com/ja/MSWorkers/support.996.ICU` |

React plus the two smallest eligible retained repositories were selected from
the prior plan and immutable lookup. The completed current dry-run confirms
the same selection; final source/page verification follows publication.

### Scheduled continuation

The actual CLI acquired token 5 at `2026-10-22T00:35:28.763Z` and completed
snapshot capture. It sealed the 134-object canonical phase of recovery
generation `bootstrap-aggregate-recovery-8adece3468c17fa8`, then staged 220
of 10775 recovery base objects before the controlled pause. The repaired
generation has not been published.

Measured recovery base progress was 62 objects at `00:51:12.096Z` and 141
at `00:52:33.964Z`: approximately 0.96 objects/second. At that observed
rate, even the remaining recovery base alone cannot finish before the
forbidden daily `02:50-03:30 UTC` window. A second base plus verification is
also required. Continue after the window; do not let this attempt overlap it.

The owned CLI was interrupted with SIGINT (exit 130). Its normal reviewed
`AggregateHistoryWorkerClient.withLease` cleanup then resumed the owned
session only to throw a deliberate deferral and execute its `finally`
release/checkpoint path. Cleanup exited 0. No pointer/object was hand-edited,
no remote object was deleted, and no credential was created or exported.

Readback at `00:54:01.318Z` shows token 5 terminal/released with
`status=failed`, `active=false`; the local checkpoint also says `failed`.
That status records an intentional pause, not a published import. Preserve
the generation and checkpoint for the documented new-token resume. The
original bootstrap/views/live pointers and both health records are unchanged.
Local import and cleanup commands have exited; no import is left running.

Resume from the [plan's continuation checklist](../../plans/736-preview-aggregate-import-execution.md).
After fresh idle/source checks, use the original runbook's same-generation
`--checkpoint` / `--execute` command. Do not reset the checkpoint or delete
immutable partial objects. A changed source pointer or immutable conflict
requires investigation as the original runbook specifies. Actual publication
counts, after screenshots, source/weekly labels, unavailable-repository checks
and the final delivery-head gate/PR remain unfinished.

### Resumed preflight after the scheduled window

The scheduled continuation resumed at `2026-10-22T03:30:00Z`. The sole detached
operator clone was recreated at the deployed `96b6189`; official archive
checksums and Node/Bun versions were reverified and both frozen dependency
installs passed with a clean tree. The deployment identity remains unchanged.

The normal daily job completed successfully at `03:08:36.645Z`, advancing
`live/latest.json` to `daily-2026-10-22T03-02-23-495Z` with `lease=null`.
Both workflow health records are ok. Authenticated readback still finds no
bootstrap pointer, the original managed views pointer, and terminal/inactive
token 5. The separately saved resume preflight preserves the original evidence;
the fresh read-only plan completed with exit 0 before same-generation execution.
Its full JSON is byte-identical to the original plan (SHA-256
`23b3b17ca6c8e147b616abd442982fa86e7badf22f1b22804ace0ce1f228c4c1`),
including all imported/skipped entries and incomplete edge joins.

### Same-generation resume in progress

The immediate checks passed at `03:44:04.181Z`, and the original runbook
`--execute` command acquired token 6 using the retained generation/checkpoint.
At `04:17:12.677Z`, the lease was still running and renewed through
`04:27:07.751Z`; recovery base had advanced to 1309/10775 objects without an
immutable conflict. The bootstrap pointer remained null. No publication or
post-publication verification is claimed from this progress observation.
Pinned cf independently confirmed the original deployment/version at 100%.

All 5669 current-star values in the original published lookup are positive.
After publication, the verifier must prove that the complete lookup remains
identical and unavailable history remains unobserved, rather than zero-filled.

By `04:52:54.277Z`, recovery base reached 3397/10775 objects. The client
enters that phase only after the recovery canonical stage, seal and bounded
verification finish under the new token. This confirms that the previously
sealed canonical snapshot was accepted unchanged during resume. The normal
daily live-pointer advance did not cause an immutable canonical conflict.
Publication remains pending until both complete generations are verified.

### Backend restart recovery

The completed deployment, complete unchanged read-only plan and new-token
canonical verification were already committed and pushed at `a1b79e4` before
the backend restart. The last completed monitor at `05:40:03.240Z` observed
5814/10775 recovery base objects, token 6 renewing and no bootstrap pointer.
The restart interrupted the local operator process; publication is unconfirmed
and the same generation/checkpoint is retained. Fresh process/lease/pointer
inspection precedes any retry, and no second writer will be started alongside
an existing process.

Fresh restart readback matched the original deployment, bootstrap/views source
pointers and reviewed live generation with a null live lease. The only active
workflow lease was this import's still-unexpired token 6, with no surviving
local writer. Official archive checks and runtime versions passed again.
The exact runbook execution command resumed at `05:47:37.695Z` and retained
token 6; snapshot rereading and immutable replay precede further new writes.
No checkpoint/generation reset, new writer, object overwrite or pointer edit
was used. The publication and post-verification remain pending.

At `06:42:19.170Z`, the recovery base had advanced from the retained 5872
objects to 6406/10775. This confirms the restart reread/immutable replay passed
and new staging resumed under the same token 6, without an immutable conflict.
The lease was renewed through `06:52:05.618Z`; the bootstrap pointer remained
null. Publication and after-page evidence are still pending.

### Recovery base write phase sealed

Readback at `08:11:16.525Z` confirms the recovery base manifest is sealed with
10775 objects, alongside its sealed 134-object canonical phase. This records
write-stage completion, not completion of the bounded verification pass.
The importer remains running under token 6; the repaired canonical prefix still
has zero staged objects at this observation, and the bootstrap pointer is null.
No publication or after-page evidence is claimed from this milestone.

### Recovery and repaired canonical verification complete

At `09:00:29.356Z`, the repaired base prefix contained 36 staged objects and
the repaired 134-object canonical manifest was sealed. The reviewed client
enters base staging only after the recovery canonical/base verification and
repaired canonical stage/seal/verification complete. Those phases therefore
passed under token 6. The original recovery holds 134 canonical and 10775 base
objects; its immutable snapshot remains available for the eventual pointer's
previous generation. Repaired base staging and its verification/publication
remain pending, and the bootstrap pointer is still null.
