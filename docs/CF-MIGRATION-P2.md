---
owner: operations / preview
status: active
last_reviewed: 2026-09-17
source_of_truth_for:
  - Cloudflare migrate P2 cache-invalidation port
  - non-production CF Preview + Access login path
  - optional CF Preview CI dual-run
  - Workers Observability for CF Preview
---

# Cloudflare migrate P2 (ISR / Preview / observability)

> Cloudflare migrate **P2** only: abstract `revalidatePath` / `revalidateTag`,
> make Preview resolution pluggable (`vercel` | `cf`), document Access on the
> non-production Worker host, and dual-run an optional CI probe. This does
> **not** cut DNS, does **not** orange-cloud apex/www, does **not** bind Access
> to apex/www, does **not** change production Vercel Deployment Protection,
> does **not** change the production `web/vercel.json` cron table, and does
> **not** replace `.delivery.yml` required checks with CF-only gates.

## Scope

This document owns the P2 change added in `web/lib/cache-invalidation/`,
`web/lib/preview/`, `web/scripts/resolve-preview.ts`,
`web/scripts/cf-preview-hot-path.ts`, and the Preview routes on
`workers/gitstarclub-web/`:

- Cache-invalidation port wrapping `revalidatePath` / `revalidateTag`
- Vercel driver remains the default (production and unset env)
- CF driver is a testable stub (`cf-stub`); it does not call Cache Purge
- Preview target `PREVIEW_TARGET=vercel` (default) or `cf`
- Cloudflare Access on `gitstarclub-web.worldgo.workers.dev` only
- Optional GitHub Actions job `verify / cf-preview` (not a production required check)
- Workers Observability + structured Worker run logs

Out of scope: DNS / orange-cloud, Access on apex/www/`pre.gitstarclub.com`,
deleting production Blob, making R2 the production read primary, changing
production Vercel Authentication, replacing `preview-e2e` / `product-gates`,
P3 full-site Workers hosting (see [CF-MIGRATION-P3.md](./CF-MIGRATION-P3.md)),
paid-plan purchases, promoting to `main`.

Prepared Cloudflare resources (documentation only; production Preview and
product-gates stay on Vercel):

- Access application: `gitstarclub-web-preview`
- Protected host: `gitstarclub-web.worldgo.workers.dev` (no apex / www)
- Allow: `@zksc.io` via the existing OTP IdP
- CI Service Token name: `gitstarclub-cca-ci` (secrets stay in GitHub / CF; not in git)
- Worker: `gitstarclub-web` (`observability.enabled` already on)

## Production source of truth

Production ISR invalidation is still Next.js on Vercel:

- `CACHE_INVALIDATION_DRIVER` unset or `vercel` → `next/cache`
- Publication still POSTs `/api/workflows/refresh/revalidate` on the owning
  Next deployment
- Live cron still revalidates `/`, `/pulse`, and current ranking paths after
  the live pointer commits
- `PREVIEW_TARGET` unset or `vercel` → existing
  `web/scripts/resolve-vercel-preview.ts` path used by `preview-e2e` and
  `product-gates`
- `.delivery.yml` `ci.checks` stays
  `[static, production-build, preview-e2e, product-gates]`
- `web/vercel.json` cron rows are unchanged
- Vercel Authentication stays on Preview (`pre.gitstarclub.com` / `*.vercel.app`);
  production `gitstarclub.com` / `www.gitstarclub.com` stay public

`VERCEL_ENV=production` refuses `CACHE_INVALIDATION_DRIVER=cf-stub|memory` and
`PREVIEW_TARGET=cf` so a mis-set flag cannot become the production gate.

## Cache-invalidation port

| `CACHE_INVALIDATION_DRIVER` | Where | Behavior |
|---|---|---|
| `vercel` (default) | Vercel Production / Preview | `next/cache` `revalidatePath` / `revalidateTag` |
| `memory` | tests | In-process op ledger |
| `cf-stub` | non-production only | Records ops, emits JSON `cache.invalidate` lines; optional POST to `CF_CACHE_PURGE_URL` |

`invalidatePublishedViews` in `web/lib/workflows/publication-cache.ts` takes the
port. Tests assert the published-views tags plus hot paths `/` and `/pulse`.

The CF stub is **not** a Cloudflare Cache Purge implementation. P3 hosting can
replace the stub. Dual-run optional POST body:

```json
{ "v": 1, "driver": "cf-stub", "ops": [{ "kind": "path", "path": "/" }] }
```

## CF Preview + Access login path

Humans (non-production only):

1. Open `https://gitstarclub-web.worldgo.workers.dev/preview/identity`
   (or `/preview/health`).
2. Cloudflare Access prompts for the existing OTP IdP.
3. Sign in with an `@zksc.io` mailbox. Access application name:
   `gitstarclub-web-preview`.
4. After login, the Worker returns `{ commitSha, deploymentUrl, target: "cf", host }`.

Do **not** attach this Access application to `gitstarclub.com`,
`www.gitstarclub.com`, or `pre.gitstarclub.com`. Staging for the Next app
remains Vercel Authentication on `pre.gitstarclub.com`.

CI (optional job only):

```text
CF-Access-Client-Id:    $CF_ACCESS_CLIENT_ID
CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET
```

Those values come from the Access Service Token named `gitstarclub-cca-ci`.
Put them in GitHub Actions secrets with **those exact environment variable
names**. Do not commit the token. `CRON_SECRET` is only needed to POST
`/preview/invalidate`; identity GET is Access-gated at the edge and does not
use `VERCEL_AUTOMATION_BYPASS_SECRET`.

Worker routes behind Access:

| Path | Auth after Access | Purpose |
|---|---|---|
| `GET /preview/identity` | none (Access only) | Preview identity JSON |
| `GET /.well-known/deployment` | none (Access only) | Same identity shape for the pluggable resolver |
| `GET /preview/health` | none (Access only) | Liveness + observability flag |
| `POST /preview/invalidate` | `Authorization: Bearer $CRON_SECRET` | Record `/` + `/pulse` stub invalidation |
| `/start`, `/enqueue` | `CRON_SECRET` | P1 refresh shell (unchanged) |

## Optional CI job

`verify / cf-preview` in `.github/workflows/ci.yml` runs **only** when the
repository variable `CF_PREVIEW_ENABLED` is `1`. It is omitted from
`.delivery.yml` and must not be added to the GitHub required-check ruleset
that protects `pre` / `main`.

When enabled, configure:

| Name | Where | Purpose |
|---|---|---|
| `CF_PREVIEW_ENABLED` | GitHub Actions variable | `"1"` to run the job |
| `CF_PREVIEW_ORIGIN` | GitHub Actions variable (optional) | Default `https://gitstarclub-web.worldgo.workers.dev` |
| `CF_ACCESS_CLIENT_ID` | GitHub Actions secret | Service Token id (`gitstarclub-cca-ci`) |
| `CF_ACCESS_CLIENT_SECRET` | GitHub Actions secret | Service Token secret |
| `CRON_SECRET` | GitHub Actions secret (optional) | Enables the hot-path invalidate POST |

`preview-e2e` and `product-gates` keep calling
`web/scripts/resolve-vercel-preview.ts`. They are unchanged production gates.

## Observability

Prefer these surfaces over the Vercel Workflows product UI (removed in P1):

1. **Self-built run logs (production truth):** `ops/workflows/health/*.json`,
   `ops/sync-runs.json`, `ops/workflows/<run_id>/steps/*.json`, and structured
   `[ALERT]` Function logs. Sunday 06:00 still uses
   `ops/workflows/health/workflow-refresh.json`.
2. **Workers Observability (CF dual-run):** Cloudflare dashboard → Workers →
   `gitstarclub-web` → Observability. The Worker emits JSON lines
   (`event=preview.identity` / `cache.invalidate` / `workflow.step`).
   `wrangler.jsonc` already has `observability.enabled: true`.
3. **Do not** treat Vercel Dashboard → Observability → Workflows /
   `workflow inspect` as the operator path.

## Dual-run rollback

If the optional CF Preview job or `cf-stub` driver misbehaves:

1. Set GitHub variable `CF_PREVIEW_ENABLED` off (or delete it). The optional
   job is skipped. Do not touch `.delivery.yml` required checks.
2. Set `PREVIEW_TARGET=vercel` (or unset) and
   `CACHE_INVALIDATION_DRIVER=vercel` (or unset) on the Next deployment.
3. Leave Vercel Authentication, `VERCEL_AUTOMATION_BYPASS_SECRET`,
   `web/vercel.json`, and production DNS exactly as they are.
4. Do not cut DNS. Do not bind or unbind Access on apex/www. Do not delete
   production Blob.

After that, Preview resolution and ISR invalidation are Vercel-only again.
The Worker can stay deployed as a shell.

## What this PR does not claim

- Production Preview / product-gates are still Vercel.
- Production ISR invalidation is still `next/cache` on Vercel.
- Apex / www DNS and Cloudflare orange-cloud are unchanged.
- Access is not attached to apex/www.
- Jason still has to approve any later DNS cut or CF-only required check.
