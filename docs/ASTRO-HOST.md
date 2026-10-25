---
owner: architecture / operations
status: active
last_reviewed: 2026-10-25
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

## About-page paint timing

The #735 local diagnostic identified the shared 620 ms `animate-rise` title
animation as the English About page's late largest contentful paint (LCP).
The title became the largest candidate at 680-700 ms while the local fonts
completed around 36 ms; the Japanese page's larger paragraph painted earlier.
The same five-run diagnostic reported web at 704 ms, so the earlier 244 ms web
comparison is sensitive to animation/renderer timing rather than a stable
font or network difference. Astro About opts out of the shared hero's title
animation, making its final text visible immediately without changing the
settled layout, content or client JavaScript. Other hero callers retain their
existing default. The five-run follow-up reduced Astro English About LCP from
684 ms to 64 ms (FCP stayed 32 ms); Japanese LCP was 64 ms before and 68 ms
after. Final exact-head full performance results are recorded in the PR.

## Host and operational contract

[Astro configuration](../astro/cloudflare.config.ts) reuses the existing
[typed resource contract](../web/cloudflare.config.ts) and
[public mode vars](../web/host-contract.mjs), changing the entry and asset paths.
The second integration sync (#735) carries the web host's preview-only schedules
and removal of first-publication flags. Source configuration does not activate
remote schedules; deployment remains separately authorized. DNS, routes, secrets
and resource names are unchanged.

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
| Scheduled triggers | absent | `0 3 * * *`, `0 4 * * SUN`, `0 6 * * SUN` |

Both modes omit `WORKFLOW_COLD_START`, `PREFLIGHT_RELAX_EMPTY_SHARDS` and
`WORKFLOW_FIXTURE`. The shared host-contract gate validates the Astro entry and
asset paths as well as the web host; `validate:host` also checks the built
mode-specific schedules and absence of the flags. The adapter-free
`astro/host-contract.ts` factory lets the existing web static job perform that
check after its web install, without an additional Astro dependency install.

The scheduled entry delegates to the same `handleScheduled`/`planCronDispatch`
as web: daily calls `/api/cron/daily`, Sunday 04:00 calls `/api/cron/weekly`,
and Sunday 06:00 starts managed refresh at `/api/workflows/refresh/start`.
The built-entry regression test intercepts those authenticated GETs at a local
synthetic HTTP server, including Cloudflare numeric Sunday aliases and failure
propagation. It never invokes a deployed operational endpoint.

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

### Preview aggregate import

`/preview/aggregate-history-import` delegates every HTTP method (including the
trailing-slash form) to the shared Worker classifier and `handleShellFetch`
before Astro asset rendering, publication reads or page caching. PR #734's
handler is reused directly: only `DEPLOY_ENV=pre` together with
`R2_BUCKET=gitstarclub-data-pre` enables it. Other configurations return 404
before authentication, body parsing or DATA access. Enabled preview accepts
only POST, requires the explicit Worker `CRON_SECRET` bearer, and checks the
bound bucket's `_meta/bucket-identity.json` on every authenticated call. Missing
or mismatched identity returns 404; checksum/protocol failures retain the
shared 409 response. The endpoint remains independent of publication pointers.

Both-mode `validate:host`, the actual P7 Worker tests and built web/Astro HTTP
parity exercise these guards with synthetic local bindings, including a marker
change after a successful read. They compare status, security/cache headers and
body bytes. No test acquires an import lease or calls a deployed host. The
[import runbook](analysis/PREVIEW-AGGREGATE-IMPORT.md) still requires separate
operator authorization for deployment or remote execution.

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

## Build, validation and authorized deployment

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
exact-commit, non-fixture pre artifact, including `validate:host`, then copies
the reviewed output into a temporary directory under `KANBAN_TMP`, resolving
symlinks. The pinned cf 1.0.0-beta.18 reads `.cloudflare/output` from its working
directory and has no output-directory option, so deployment runs
`cf deploy --prebuilt --mode pre --no-provision` from that self-contained copy.
The copy is removed afterward; the original artifact remains in place.
The shared web/Astro configuration pins preview `GSC_CACHE` to the existing
`gitstarclub-web-pre-gsc-cache` namespace (`4c3107414bad4a0386fedfcf96dde6e2`)
because this cf version accepts a KV id but no title. Production's binding is
unchanged. Provisioning stays disabled, and the script cannot select production.
The generated preview contract contains no routes and exactly the schedules
`0 3 * * *`, `0 4 * * SUN`, and `0 6 * * SUN`; production has no scheduled triggers. Review that
contract and existing bindings before authorized deployment. No deployment
command is part of local verification, CI, or this integration card.
Wrangler, legacy packaging aliases and cf:dry-run remain forbidden by owner order.

### Guarded production entry point

After separate owner authorization, `bun run deploy:production` is available
from the root or `astro/`. It requires `KANBAN_TMP/astro-host-build.json` to
identify a production, non-fixture build of the exact current commit and a
clean checkout, including untracked files. It checks the built production
mode, Worker `gitstarclub-web`, DATA/R2 `gitstarclub-data-prod`, JOBS producer
and consumer `gitstarclub-jobs`, public data origin
`https://data.gitstarclub.com`, R2 read/write drivers, and enabled indexing.
Blob fixture bindings are forbidden. The only trigger is the production queue;
schedules, routes and domains are refused. Production schedules require a
separate, later owner decision.

The production `GSC_CACHE` binding must have an explicit existing namespace ID;
the preview ID is refused. Resolve the current `gitstarclub-web` binding
read-only and pin that same ID in the reviewed production host contract before
building. If the Worker has no such binding, stop and report; never create one.
The #773 sandbox has no Cloudflare authentication (`cf auth whoami` reports
`authenticated: false`, `Not logged in`), so the production namespace could
not be resolved. The production source binding remains unpinned and this
entry point deliberately refuses it. Account access and the read-only KV
resolution remain required before production deployment can be accepted.

Once those guards pass, the script runs `validate:host -- --mode production`,
which also compares the artifact's bindings against the reviewed host contract
and checks actual HTML, headers and robots indexing. It rechecks the local
guards, verifies cf 1.0.0-beta.18, and uses the same temporary, non-symlink
prebuilt directory as preview with
`cf deploy --prebuilt --mode production --no-provision`. The copy is removed
afterward. No resource provisioning or deployment is part of verification.
For a local guard-only check, import `assertProductionArtifact` from
`astro/scripts/production-deploy-guards.ts`; importing it never invokes cf.

## Caching and publication

The Worker is the sole HTML cache boundary. It reuses the bounded Cache API/KV
artifact store. Cache keys separate build, origin, path/query and locale.
All HTML, including repository, organization and category pages, is namespaced
by publication identity. Core HTML is cached for one hour. Within a publication,
long tails stay fresh for seven days, serve stale during one further day while
regenerating, then block. A publish or rollback selects a new namespace for every
page; old entries expire through normal retention. The authenticated publication
callback clears the pointer memo and two shared pointer tags (four KV writes),
without listing or invalidating individual page paths. Explicit path invalidation
remains available and awaited. Cookies, auth, ranges, non-GET, APIs and controls bypass
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
