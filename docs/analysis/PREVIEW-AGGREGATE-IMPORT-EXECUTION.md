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
| `cd web && bun run validate:views -- scripts/fixtures/views` | Pass |
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
`bootstrap-aggregate-gap-20261022T001946Z`; no import execution has started.

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

React plus the two smallest eligible retained repositories are selected from
the prior plan and immutable lookup; the completed current dry-run and final
verifier must confirm the same selection before this becomes import evidence.
