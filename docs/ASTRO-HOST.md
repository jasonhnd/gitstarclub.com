---
owner: architecture / operations
status: active
last_reviewed: 2026-10-22
source_of_truth_for:
  - Astro Worker configuration and delivery
  - publication-fenced page caching
  - local host verification
---

# Astro Worker host

`astro/` is the current integrated site source. Astro 7.4.1 uses the official
Cloudflare adapter 15.0.0-beta.3, Cloudflare Vite plugin 2.0.0-beta.v.3, Vite
8.3.4 and cf 1.0.0-beta.18. See [FRONTEND.md](FRONTEND.md) for pages and islands.
`web/` remains the comparison baseline and a shared-code dependency; source
integration does not claim a live cutover. Deployment requires separate owner
authorization. GitHub Actions stays disabled. CI configuration and the two
required job names, `static` and `production-build`, are unchanged.

## Host and operational contract

[Astro configuration](../astro/cloudflare.config.ts) reuses the existing
[typed resource contract](../web/cloudflare.config.ts) and
[public mode vars](../web/host-contract.mjs), changing the entry and asset paths.
No schedules, DNS, routes, secrets or resource names change.

| Contract | production | pre |
| --- | --- | --- |
| Worker / self-reference | gitstarclub-web | gitstarclub-web-pre |
| DATA | gitstarclub-data-prod | gitstarclub-data-pre |
| MEDIA | gitstarclub-assets | gitstarclub-assets |
| JOBS producer / consumer | gitstarclub-jobs | gitstarclub-jobs-pre |
| Queue max batch / retries | 1 / 2 | 1 / 2 |
| GSC_CACHE | Existing Worker KV binding | Existing Worker KV binding |
| Public data origin | data.gitstarclub.com | data-pre.gitstarclub.com |
| workers.dev / version URLs | disabled / disabled | enabled / enabled |
| Indexing | index, follow | noindex, nofollow |
| Scheduled triggers | absent | absent |

KV is the persistent key/value page cache. DATA is the native R2 data binding;
MEDIA stays the shared asset bucket. JOBS is the refresh task queue.
`WORKER_SELF_REFERENCE` keeps step calls inside the same Worker.
The [entry](../astro/src/worker.ts) wraps fetch, scheduled and queue events in
request-scoped bindings and reuses the original shell/dispatch/consumer code.
`/start`, `/enqueue`, `/preview/invalidate`, `/preview/identity` and
`/preview/health` retain the original authentication/control behavior; health
identifies `astro`. Deployment identity always reports the baked commit.
Queue failures propagate for the existing retry policy. Scheduled handlers
remain available without creating or enabling any trigger.
P7 retains all cron, refresh, lease, publication and rollback implementations.
No runtime database, AI, live search or alternate writer is introduced.

### Refresh checkpoints and consumer parity

The Astro entry imports `handleQueue` from the
[shared Worker shell](../workers/gitstarclub-web/src/shell.ts); its P7 `step` handler imports
`runRefreshStepRoute` from `web/lib/workflows/runtime/step-route.ts`. These are
the same implementations used by the web Worker, including PR #717/#722/#724.
No copied graph or Astro-specific successor table needs to be kept in sync.

Validation, repository/organization recomputation, publication and garbage
collection preserve `cursor.workOffset` across pages and write separate
`<step>-<offset>` checkpoints. The unnumbered checkpoint is written only when
the sequence finishes; the next logical step drops the previous offset.
Publication commits the pointer on page zero, derives notification candidates
in bounded later pages, and then advances to garbage collection.

The shared consumer calls `WORKER_SELF_REFERENCE` with the consumer-advance
header, awaits the result body, and sends its successor through `JOBS`. A
subrequest-limit failure moves diagnostic writes to a fresh delivery. An
unreadable body can still advance through the successor response header; a
failed diagnostic delivery propagates for the existing Queue retry policy.

`astro/tests/p7/queue-budget.test.ts` runs that exact imported consumer through
the real Astro P7 `step` handler with the shared 5,669-repository/owner fixture.
The service binding and queue are local test ports; physical storage/fetch
operations are counted by the shared runtime harness. It covers the complete
chain, page checkpoints, publication, garbage collection, JSON/header failure
successors and diagnostic-delivery retries. The built-entry Queue dispatch is
also exercised by `astro/worker-checks/operations.test.ts`. Together these
tests cover Astro's actual shared consumer path; they do not certify remote
Cloudflare subrequest accounting or production load.

## Build, validation and authorized pre deployment

Use Node 24.20.0 and Bun 1.4.2 from the checksum-verified AGENTS bootstrap.
Set card-local `TMPDIR=KANBAN_TMP`; keep HOME and the shared Bun cache.
From the root, install frozen root/web/pipeline/Astro dependencies, then:

```bash
bun run build:production
bun run validate:host -- --mode production
bun run build:pre
bun run validate:host -- --mode pre
```

The same commands work inside `astro/`; its `build` means production.
`verify:local` deliberately builds pre for parity with the retained web host.
Output, generated types, simulator state and reports stay under KANBAN_TMP.
Builds overwrite the same output: validate each mode immediately after building.
The local validator loads the actual Worker with synthetic DATA and checks
bindings, queue configuration, indexing headers/HTML/robots, local font families,
CSP, deployment identity, the default 1200 x 630 PNG, and deferred cockpit 404s.
Both modes keep `script-src 'self' 'unsafe-inline'` and package fonts locally.
Static assets receive the same security headers. `/opengraph-image` is the
shared default card; repo/ranking cards retain their existing endpoints.
Static `/data/exports/v1/latest/*` URLs internally resolve to the newest
checked-in dated export, preserving the old rewrite without duplicate payloads.

After separate owner authorization, `bun run deploy:pre` validates a clean,
exact-commit, non-fixture pre artifact, then calls the pinned
`cf deploy --prebuilt --mode pre --no-provision`. It cannot select production.
The generated contract contains no route or scheduled trigger. Review that
contract and existing bindings before authorized deployment. No deployment
command is part of local verification, CI, or this integration card.
Wrangler, legacy packaging aliases and cf:dry-run remain forbidden by owner order.

## Caching and publication

The Worker is the sole HTML cache boundary. It reuses the bounded Cache API/KV
artifact store. Cache keys separate build, origin, path/query and locale.
Core HTML is cached for one hour and namespaced by publication identity.
Long tails stay fresh for seven days, serve stale during one further day while
regenerating, then block. Ordinary publication keeps warm tails; explicit path
invalidation is awaited. Cookies, auth, ranges, non-GET, APIs and controls bypass
shared HTML storage. A bypass does not waive publication correctness.

Capture `views/latest.json`, `bootstrap/latest.json` and `live/latest.json`
directly through DATA, including body, ETags and transition timestamps. Readers
use that captured publication. Fully consume read-only GET/HEAD output and
recheck before serving/writing; retry one race, then return 503. Mutations
execute once, including the legacy daily/weekly cron and refresh-start GET/HEAD
handlers. Their own publish or a post-write pointer outage must preserve the
original operation result instead of retrying or reporting a false failure.
Unreadable/invalid pointers fail closed. Language GET/HEAD and revalidation POST
remain explicitly publication-independent; shell controls dispatch first.
Manual KV invalidation retains eventual-consistency limits. The old vinext
HTML/RSC snapshots are not imported as Astro output; Astro caches its final HTML.

## Local release evidence and deferred activation

Run the complete [AGENTS.md](../AGENTS.md) static/build block in one fresh
exact-head shared clone, plus Astro `verify:local`, `bun audit`, both host modes,
all seven package runners, `crawl:local` and root `lint:design`.
P5 uses native Astro `/repo-curve` and `/search-index` without a web-host proxy.
The crawl follows local pages, sitemaps, redirects and linked assets across all
seven locales. It never calls remote operational endpoints.
Record results in the PR, then remove the clone and bulky temporary output.
Local simulation does not establish multi-region performance or service limits.
Adapter/plugin prereleases remain a release risk. Preview deployment, measured
live first paint, refresh/rollback rehearsal, independent review, owner visual
acceptance and cutover remain separate authorized steps. Cockpit stays only in
`web/`; the Astro host returns 404. See the migration plan's
[after-cutover inventory](../plans/astro-migration.md#after-cutover).
