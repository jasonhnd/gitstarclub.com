---
owner: operations / hosting
status: active
last_reviewed: 2026-09-18
source_of_truth_for:
  - Cloudflare migrate P3 Workers hosting of the Next app
  - vinext vs OpenNext adapter choice
  - non-production workers.dev / wrangler preview
  - Workers host rollback (production stays Vercel)
---

# Cloudflare migrate P3 (Workers host / OpenNext preview)

> Cloudflare migrate **P3** only: run the existing Next.js 16 app on the
> `gitstarclub-web-pre` Worker as a **non-production preview**. This does **not**
> cut DNS, does **not** orange-cloud apex/www, does **not** make Workers the
> production origin, does **not** change `web/vercel.json` cron, and does
> **not** replace `.delivery.yml` required checks.

## Scope

This document owns the P3 change added in `web/open-next.config.ts`,
`workers/gitstarclub-web/`, `web/lib/workers-host/`, and the optional
`verify / cf-workers-host` job:

- Adapter choice: **OpenNext** (`@opennextjs/cloudflare`), not vinext
- Wrangler bindings already prepared in P0–P2: R2 `MEDIA` → `gitstarclub-assets`,
  Queue `JOBS` → `gitstarclub-jobs`
- Composed Worker: P1–P2 shell routes stay on the Worker; `/` and product
  routes go to the OpenNext Next server
- Preview reads go through the P0 storage port (default **Blob**; R2 only when
  the documented driver switches are set)
- P1 runtime stays available (`/start`, `/enqueue`, Queue consumer). Production
  scheduling stays Vercel
- Vercel Web Analytics is off on the CF host
- Optional CI OpenNext dry-run (not a production required check)

Out of scope: DNS / orange-cloud, binding apex/www as the only entry,
deleting production Blob, making R2 the production read primary, changing
production Vercel Authentication or cron, replacing `preview-e2e` /
`product-gates`, P4 cutover, paid-plan purchases, promoting to `main`.

Prepared Cloudflare resources (documentation only; production apex/www stay
Vercel):

- account_id: `00f850e853e4c7f9627233d51a6e30a1`
- Production Worker: `gitstarclub-web` (main; production workers.dev is closed)
- Preview Worker: `gitstarclub-web-pre` (`gitstarclub-web-pre.worldgo.workers.dev`, wrangler env `pre`)
- R2: `gitstarclub-assets` binding `MEDIA`
- Queue: `gitstarclub-jobs` binding `JOBS`
- Access application `gitstarclub-web-preview` may still cover workers.dev.
  **Build and OpenNext dry-run do not require Access.** Jason may take Access
  down for human preview; this PR does not attach Access to apex/www.

## Adapter choice (vinext vs OpenNext)

Cloudflare currently recommends [vinext](https://vinext.dev/) for new Next.js
apps on Workers. P3 ran `vinext check` from `web/` on 2026-09-17 against
Next.js 16.3.5:

| Check | Result |
|---|---|
| Overall | 92% compatible (17 supported, 1 partial, 1 issue) |
| `next/font/google` | Partial — CDN-loaded, not self-hosted at build time |
| `package.json` `"type": "module"` | Missing (Vite would add it) |
| App Router / `proxy.ts` / `next/og` | Reported supported |
| `@vercel/analytics` | Reported compatible as a client script |

P3 still selects **OpenNext**, not vinext:

1. Production remains Next.js on Vercel. OpenNext consumes the same
   `next build` output; vinext is a **beta Vite reimplementation** of the
   Next API surface and would be a second toolchain.
2. vinext's partial `next/font/google` path would change how Plus Jakarta Sans
   / Geist Mono load versus the Vercel production site.
3. The existing P1–P2 Worker already has Queue / Cron / R2 / Observability.
   OpenNext's generated worker can be wrapped from `workers/gitstarclub-web`
   without replacing that shell.
4. Official Cloudflare docs keep OpenNext for existing apps that cannot yet
   move to vinext because of a compatibility or dual-runtime gap.

Revisit vinext only in a later, explicit host-adapter issue. P3 does not do P4.

## Production source of truth

Production apex / www stay on Vercel:

- `gitstarclub.com` / `www.gitstarclub.com` DNS is unchanged
- `web/vercel.json` cron rows are unchanged
- `.delivery.yml` `ci.checks` stays
  `[static, production-build, preview-e2e, product-gates]`
- `HOSTING_TARGET` unset or `vercel` on Vercel
- `VERCEL_ENV=production` refuses `HOSTING_TARGET=cf` so a mis-set flag cannot
  become the production origin switch

`workers.dev` (or `wrangler preview` on localhost) is a **preview**. It is not
an authority to cut DNS.

## Worker composition

The Worker entry `src/index.ts` under `workers/gitstarclub-web/` classifies each request:

| Path | Owner | Auth |
|---|---|---|
| `GET /`, `/rankings`, `/pulse`, other Next routes | OpenNext Next app | none (Access may sit in front of workers.dev) |
| `GET /preview/health` | Worker shell | none after Access |
| `GET /preview/identity`, `GET /.well-known/deployment` | Worker shell | none after Access |
| `POST /preview/invalidate` | Worker shell | `Authorization: Bearer $CRON_SECRET` |
| `GET\|POST /start`, `POST /enqueue` | Worker shell | `CRON_SECRET` |
| Queue consumer / `pre` Cron | Worker shell | n/a |

`GET /` is the Next homepage. The P1 start route is **`/start` only**. The
pre-P3 shell also accepted `/` as start; that would steal the homepage.

Bindings (names only; secrets stay out of git):

| Binding | Resource | Purpose |
|---|---|---|
| `MEDIA` | R2 `gitstarclub-assets` | P0 object-store port / later binding reads |
| `JOBS` | Queue `gitstarclub-jobs` | P1 refresh enqueue / consume |
| `ASSETS` | OpenNext static assets | prerendered HTML + `/_next/static` |
| `WORKER_SELF_REFERENCE` | `gitstarclub-web` (production) / `gitstarclub-web-pre` (`env.pre`) | OpenNext self-fetch |

Incremental cache is **Workers Static Assets** (`staticAssetsIncrementalCache`),
not an R2 incremental-cache bucket. That avoids `populateCache remote`, which
fails when `*.workers.dev` is Access-gated unless extra Service Auth is added.
ISR pages that were not prerendered render on demand and read JSON through the
P0 port (default Blob).

## Storage and runtime (P0 / P1)

Unset drivers still mean Vercel Blob. That is enough for the Workers preview
to read published views: `BLOB_BASE_URL` is the public store. Set
`STORAGE_READ_DRIVER=r2` or `r2_then_blob` only with the P0 R2 credentials and
a non-production `migrate-*` prefix. P0 still refuses R2 writes when
`VERCEL_ENV=production`.

`WORKFLOW_RUNTIME` may be `http` (Next self-chain on the Worker) or `cf-queue`
(POST Worker `/enqueue`). Production Sunday 06:00 stays the Vercel cron row.

## Analytics

`HOSTING_TARGET=cf` (and not `VERCEL_ENV=production`) turns off
`<Analytics />` and skips the Vercel insights CSP assertion. Production Vercel
keeps Vercel Web Analytics. No GA / third-party scripts.

## Build, preview, and known limits

From `web/`:

```bash
# Read-only fixture (CI) or a public BLOB_BASE_URL (content smoke)
bun run cf:build
bun run cf:preview          # wrangler dev on :8787
bun run cf:smoke            # defaults to localhost without Access
bun run cf:dry-run          # OpenNext build + wrangler deploy --dry-run --env pre (never live-deploys gitstarclub-web)
```

`cf:build` wraps `opennextjs-cloudflare build` so the Next 16 Node
`proxy.ts` bundle can resolve `@opentelemetry/api` (direct dependency for
the `next/cache` graph). That rewrite is preview-host only.

`cf:build` / `cf:dry-run` do **not** need Cloudflare Access. Remote
`workers.dev` human checks may still hit Access (`gitstarclub-web-preview`)
until Jason removes that wall.

Known limits (write these on the PR; they are not a DNS-cut claim):

| Limit | Value | P3 implication |
|---|---|---|
| Worker isolate memory | 128 MiB | Large view reads stay on Blob/CDN; do not load the search index into a second Data Cache |
| Worker CPU | tens of seconds on paid; much less on free | Preview only; production cron stays Vercel |
| Worker script size | 3 MiB gzip free / 10 MiB gzip paid | Measured dry-run (2026-09-17): **27 520 KiB / gzip 5 608 KiB** — over free, under paid. Static HTML is **assets**, not script |
| Static assets | separate from script size | Home / rankings prerender live here |
| `next build` heap | CI uses `NODE_OPTIONS=--max-old-space-size=8192` on the optional job | Same class of memory as `verify / production-build` |
| OpenNext R2 cache populate + Access | helper Worker `open-next-cache-populate` is Access-blocked | P3 uses Static Assets incremental cache instead |
| OpenNext Node `proxy.ts` + `@opentelemetry/api` | NFT traces CJS only; esbuild `module` condition looks for missing `build/esm` | `cf:build` rewrites the traced package.json to the CJS entry |
| Category long tail | already bounded at build | Do not pre-render every category page on the Worker |
| Worker subrequests | 50 free / 1 000 paid per invocation | Free-tier budget is **total** subrequests per invocation, not peak concurrency. Each OpenNext Blob `fetch` also does an ASSETS incremental-cache GET. After #455 `mapLimit`, CF `/rankings` still blew the cap on assignment shards; it now skips assignment fan-out (language exits remain) and caps month/week lookback at 1. After #458, ranking-detail / repo / org also skip full 32-shard assignment fan-out on CF (prefer page-id `getCategoryAssignmentsForRepos`; otherwise `assignments=null`; language exits remain). Full `getCategoryAssignments` / `loadCategoryAssignments` omit-path is hard-short-circuited on the CF host. v1 monolith stays a single GET. |

This PR does **not** claim the Worker is ready to take apex/www traffic.

## Optional CI job

`verify / cf-workers-host` in `.github/workflows/ci.yml` runs **only** when
`CF_WORKERS_HOST_ENABLED=1` **and** the event is on `pre` or a PR targeting
`pre`. It is omitted from `.delivery.yml` and must not be added to the GitHub
required-check ruleset that protects `pre` / `main`. The job calls
`bun run cf:dry-run`, which is `wrangler deploy --dry-run --env pre` via
`scripts/cf-wrangler-dry-run.mjs`. It must not live-deploy `gitstarclub-web`.

When enabled:

| Name | Where | Purpose |
|---|---|---|
| `CF_WORKERS_HOST_ENABLED` | GitHub Actions variable | `"1"` to run the OpenNext dry-run job |
| `CF_WORKERS_HOST_ORIGIN` | optional smoke override | Preview origin; smoke defaults to `http://127.0.0.1:8787` without Access |
| `CF_WORKERS_HOST_LOCAL` | optional smoke | `"1"` forces localhost |

The job uses the same read-only fixture as `production-build`. It does not
deploy, does not call Access, and does not replace `preview-e2e` /
`product-gates`.

## Rollback

If the Workers preview or optional job misbehaves:

1. Unset GitHub variable `CF_WORKERS_HOST_ENABLED` (or delete it). The optional
   job is skipped. Do not touch `.delivery.yml` required checks.
2. Leave the Worker deployed as a shell, or `wrangler rollback` the
   `gitstarclub-web-pre` Worker only. Do not change Vercel production. Do not
   roll back production `gitstarclub-web` from a preview incident.
3. Set `HOSTING_TARGET=vercel` (or unset) on any Next deployment that
   accidentally received it.
4. Leave `web/vercel.json`, Vercel Authentication, and production DNS exactly
   as they are.
5. Do not cut DNS. Do not orange-cloud apex/www. Do not delete production Blob.

After that, humans use Vercel (`gitstarclub.com` / `pre.gitstarclub.com`)
again. The Worker can stay as the P1–P2 shell.

## What this PR does not claim

- Production origin is still Vercel.
- Apex / www DNS and Cloudflare orange-cloud are unchanged.
- Access is not attached to apex/www.
- OpenNext preview is not a DNS-cut readiness sign-off.
- Jason still has to approve any later DNS cut or CF-only required check.
