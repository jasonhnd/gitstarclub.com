---
owner: operations
status: historical
last_reviewed: 2026-10-19
source_of_truth_for:
  - pre-vinext host procedure history
---

# Host procedures before vinext

Historical evidence only. These commands are retired and must not be executed.
Use [the current host runbook](../VINEXT-HOST.md).

## Current hosting and branch topology

As checked on 2026-09-24, both `https://gitstarclub.com` and
`https://pre.gitstarclub.com` returned `server: cloudflare` and `x-opennext: 1`.
The current web host is Cloudflare Workers with OpenNext: `gitstarclub-web`
serves production (`main`), and `gitstarclub-web-pre` serves preview (`pre`).
The `www` hostname belongs to the production domain set, but this check did
not independently probe its response. JSON storage is Cloudflare R2 (production cutover accepted 2026-10-04; see [R2-CUTOVER.md](./R2-CUTOVER.md)).

Feature PRs target `pre`; promotion is a separate merge from `pre` to `main`.
The CI gate forbids a live production Worker deploy from repository automation,
and its production `triggers.crons` contract remains `[]`.

### Deployment and scheduler evidence (2026-09-24)

| Surface | Observed or declared state |
|---|---|
| Production web | `gitstarclub.com`: `server: cloudflare`, `x-opennext: 1` |
| Preview web | `pre.gitstarclub.com`: `server: cloudflare`, `x-opennext: 1` |
| Production Worker schedule | Cloudflare schedules API observation in issue #528 at 03:30 UTC: `gitstarclub-web` = `[]`; repository gate requires `triggers.crons: []` |
| Preview Worker schedule | Same API observation: `gitstarclub-web-pre` = `0 3 * * *`, `0 4 * * 7`, `0 6 * * 7`. On Cloudflare `7` is Saturday, so the two weekly schedules fired on Saturday, not Sunday (#546). The owner paused all preview schedules on 2026-09-25/26 (#543); the repo keeps `env.pre` `triggers.crons` at `[]` |
| Production refresh trigger | Owner reports Cloudflare, but no production Worker Cron schedule was observed. An external caller, another Worker, or a changed schedule after the snapshot remains unverified. Do not infer the mechanism from route code or `web/vercel.json`. |

The Worker `scheduled` handler dispatches the three cron expressions to the
protected daily, weekly, and refresh routes. The historical preview schedule observation proves configuration only at that timestamp; it establishes neither the current schedules nor a production trigger. The production trigger requires an operator-provided schedule or
request log showing caller, target, and timestamp. `web/vercel.json` is in the
repository. It does not establish a live production caller. Do not infer the
production trigger from that file. Do not change the
production gate to reconcile the owner's statement without that evidence.

### Environment variable source

Production and preview Worker variables and bindings are declared in
[Worker configuration](../workers/gitstarclub-web/wrangler.jsonc); runtime secrets are injected on the
Cloudflare platform and are never stored in this repository. Local development
uses `web/.env.local`. Both checked-in Worker contracts use R2: public HTTP reads and guarded `DATA` binding writes. PR #649 records the accepted production cutover and retained Blob secret on 2026-10-04; live secret presence was not rechecked. Preview does not set `BLOB_*` or the production fallback. See [R2-CUTOVER.md](./R2-CUTOVER.md).

## Branch topology

| Branch | Worker | Domain | Indexing |
|---|---|---|---|
| `main` | `gitstarclub-web` (top-level, no `--env`) | `https://gitstarclub.com` / `https://www.gitstarclub.com` | Production build sets `SITE_INDEXABLE=1` |
| `pre` | `gitstarclub-web-pre` (wrangler env `pre`) | `https://pre.gitstarclub.com` | Public. Meta robots `noindex,nofollow`. `robots.txt` is `Disallow: /` |

Feature work merges into `pre`. Promotion to production is a separate merge from `pre` to `main`.

`https://pre.gitstarclub.com` is public and served by Cloudflare. There is no login wall. `noindex` is not access control. The preview site shows public GitHub data only.

Preview is intentionally noindex. The Cloudflare production build sets `SITE_INDEXABLE=1` and `NEXT_PUBLIC_SITE_URL=https://gitstarclub.com`; the top-level Worker variables match. `bun run cf:dry-run` builds for preview with indexing disabled. Preview emits `<meta name="robots"
content="noindex,nofollow">` and `robots.txt` returns `User-Agent: *` with
`Disallow: /`. Preview reads its own R2 bucket `gitstarclub-data-pre` at `https://data-pre.gitstarclub.com`. It does not set `BLOB_*`. Production uses R2 after the accepted 2026-10-04 cutover (stage 4 in [R2-CUTOVER.md](./R2-CUTOVER.md)). Stage 6 retires the blob store.

Cloudflare owner commands (run from `web/`; build each target immediately before its matching deployment because both builds use the same output directory). GitHub Actions must not run the live deploy. `bun run cf:build --site-target=production` and `bun run cf:build --site-target=pre` are the explicit underlying forms. A bare `bun run cf:build` fails. `bun run cf:dry-run` builds pre and performs a Wrangler dry run of `env.pre` only. The build checks the generated home HTML and robots response for the selected indexing policy before deployment.

### Production build and deploy

Production cutover was owner-accepted on 2026-10-04 in PR #649 after the operator copy and config PR #648 (issue #647). The accepted production store contains copied versioned views, not only bootstrap-generation objects. The [dated public checks and evidence limits](./R2-CUTOVER.md#read-only-state-check-2026-10-13) distinguish historical acceptance from current public identity: production `daee5fc`, preview `5af183a` on October 13. Neither public identity establishes live provider bindings, secrets, schedules, or version UUID.

Current production `views/latest.json` and `bootstrap/latest.json` returned 404 at the dated check, while `views/refresh-2026-09-13T06-00-16-398Z/meta.json` returned 200. Preserve the exact frozen fallback in both the Worker and production build shell. The old bootstrap-only recipe that cleared it at cutover does not apply to this copied store.

- Top-level `DEPLOY_ENV=production` selects `STORAGE_READ_DRIVER=r2`, `STORAGE_WRITE_DRIVER=r2_binding`, `R2_BUCKET=gitstarclub-data-prod`, `R2_PUBLIC_BASE_URL=https://data.gitstarclub.com`, and exactly one `DATA` binding to that bucket. `MEDIA` remains the assets bucket.
- `scripts/cf-ci-gates.mjs` refuses checked-in `BLOB_*` vars and accepts a fallback that is absent or exactly `refresh-2026-09-13T06-00-16-398Z`. This is not permission to remove a needed fallback. Preview must have neither Blob vars nor the fallback; both checked-in cron arrays remain `[]`.
- OpenNext inherits the build shell, not the Worker vars. `cf:build` rejects a missing/different R2 read driver, missing public base, Blob shell vars, or a non-loopback base that differs from the selected target. No write driver or storage credential is needed for a read-only build.

Operator shell for a separately authorized production build while the pointer is absent. Clear any other `BLOB_*` or `NEXT_PUBLIC_BLOB_*` shell vars; if `NEXT_PUBLIC_R2_PUBLIC_BASE_URL` is set, it must match the production R2 origin:

```sh
# Worker gitstarclub-web, top-level production (no --env), bucket gitstarclub-data-prod
cd web
export STORAGE_READ_DRIVER=r2
export R2_PUBLIC_BASE_URL=https://data.gitstarclub.com
export VIEWS_VERSION_FALLBACK=refresh-2026-09-13T06-00-16-398Z
unset READ_DRIVER BLOB_BASE_URL NEXT_PUBLIC_BLOB_BASE_URL BLOB_READ_WRITE_TOKEN
bun run cf:build:production
```

A live deploy requires explicit owner approval and operator execution; GitHub automation must not deploy production. Deploy the top-level Worker with `--env=""` so `CLOUDFLARE_ENV` cannot select preview. Pass `CF_PREVIEW_COMMIT_SHA` only when it matches the SHA baked by that build. A stale runtime SHA cannot override the built identity. Run from `web/` after building that exact commit:

```sh
bunx wrangler deploy --config ../workers/gitstarclub-web/wrangler.jsonc --env="" \
  --var CF_PREVIEW_COMMIT_SHA="$(git rev-parse HEAD)"
```

Check the selected production binding/var inventory against the current wrangler contract, including `DATA`, the R2 vars, the exact fallback while needed, `ASSETS`, `WORKER_SELF_REFERENCE`, `JOBS` (`gitstarclub-jobs`), and `MEDIA`. Blob base vars must not return. PR #649 records that the Blob write secret was retained at cutover; current live secret presence was not checked here, and removal needs separately authorized stage 6 acceptance. Do not use `--keep-vars` to retain an obsolete Blob configuration. Production workers.dev and version preview URLs remain disabled in source.

After any separately authorized deploy, check `/`, `/rankings`, a representative `/<owner>/<repo>`, `/search-index`, robots, and the public deployment identity. They must remain indexable and render the intended generation, including repository rows/star counts on rankings. HTTP 200 alone is insufficient. An authoritative views pointer takes priority over the fallback; while it is absent, compare pages with the copied frozen generation. Verify outbound reads at `data.gitstarclub.com` with operator logs. Those live binding/log/page-parity checks were not repeated by this documentation card.

Remove the fallback only after the production R2 views pointer returns 200, is authoritative for page data, and a production build without the fallback prerenders real data. Change the Worker var and shell together in a separately authorized batch. Do not hand-write either pointer or remove the Blob secret before stage 6 acceptance. See the same criteria and historical rollback reference in [R2-CUTOVER.md](./R2-CUTOVER.md#stage-4-cutover-i-5b).

### Preview deploy

`env.pre` sets `workers_dev: true` and `preview_urls: true` so a preview deploy does not inherit the closed production flags. The probe host remains `https://gitstarclub-web-pre.worldgo.workers.dev`. Live `gitstarclub-web-pre` had workers.dev enabled and version preview URLs enabled on 2026-09-24; this file matches that. Turning preview URLs off for pre is a separate owner decision. `pre.gitstarclub.com/*` is not declared in `wrangler.jsonc`.

```sh
cd web
export STORAGE_READ_DRIVER=r2
export R2_PUBLIC_BASE_URL=https://data-pre.gitstarclub.com
bun run cf:build:pre
bunx wrangler deploy --config ../workers/gitstarclub-web/wrangler.jsonc --env pre \
  --var CF_PREVIEW_COMMIT_SHA="$(git rev-parse HEAD)"
```

`https://pre.gitstarclub.com` is public. There is no login wall. The preview build emits meta robots `noindex,nofollow` and `robots.txt` `Disallow: /`. `noindex` is not access control. Do not add a login lock. `preview-e2e` and `product-gates` are not GitHub required checks.

Do not run `bun run cf:build:production` and then `bun run cf:preview`. `cf:preview` is `wrangler dev --env pre` and shares the output directory with the production build. Build preview with `bun run cf:build:pre` immediately before a preview deploy.

Development flow: feature work targets `pre` through PRs into `pre`. Verify the
merged preview at `https://pre.gitstarclub.com`. Promotion to
production is a merge from `pre` to `main`.

### Cloudflare Workers (`main` → production, `pre` → preview)

These are the Cloudflare Worker names that serve the site.

| Git branch | Cloudflare Worker | wrangler env | Deploy rule |
|---|---|---|---|
| `main` | `gitstarclub-web` | top-level (default) | Production Worker only. GHA must never `wrangler deploy` this name except `--dry-run`. Production `gitstarclub-web.worldgo.workers.dev` is closed. |
| `pre` | `gitstarclub-web-pre` | `pre` | Preview Worker. Optional CI dry-run / probe only; do not live-deploy from GHA. |

`CF_PREVIEW_ORIGIN` (and `web/lib/runtime-config.ts` `DEFAULT_CF_PREVIEW_ORIGIN`)
defaults to `https://gitstarclub-web-pre.worldgo.workers.dev`.
`https://pre.gitstarclub.com` is an allowed equivalent override. Do not default
probe/dry-run at the closed production workers.dev host.

Optional `verify / cf-preview` and `verify / cf-workers-host` run only on `pre`
(or PRs targeting `pre`). **Do not** add those job names to `.delivery.yml` or
the GitHub required-check ruleset. `.delivery.yml` and `scripts/assert-cf-ci-gates.mjs`
use the same names: `main` → `gitstarclub-web` (production `triggers.crons` must
stay `[]`); `pre` → `gitstarclub-web-pre`. GHA and repo scripts must not
live-deploy `gitstarclub-web` or PUT production schedules.

**Domains**:

- Production access uses `gitstarclub.com` and `www.gitstarclub.com`.
- Preview access uses public `https://pre.gitstarclub.com`.

