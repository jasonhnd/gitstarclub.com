# Worker shell auth and security headers (#603)

## Goal

The Worker shell compares `CRON_SECRET` with the shared constant-time bearer helper, and it rejects a missing Worker secret with 401. Direct shell responses for `GET /preview/health`, `GET /.well-known/deployment` (and the same identity response), and 401s carry the site security headers. CSP stays `script-src 'self' 'unsafe-inline'` with no nonce or hash.

## Scope

- `workers/gitstarclub-web/src/shell.ts`: replace the local `===` bearer check with `hasValidBearerToken` from `web/lib/security.ts`. A missing or empty `env.CRON_SECRET` fails closed and does not fall through to `process.env.CRON_SECRET`. Apply `securityHeaders` from `web/lib/csp.ts` to the public health and deployment responses and to the 401 response.
- `web/lib/workers-host/shell-hardening.test.ts`: auth and header behavior. The constant-time assertion fails if the shell goes back to ordinary equality.
- `docs/CHANGELOG.md` and a short note in `docs/CF-MIGRATION-P3.md`.

## Out of scope

- Next route handlers. They already use `hasValidBearerToken`.
- Proxied cron and refresh responses from `triggerAuthorizedGet` / `triggerStart`.
- Authenticated 200 and 404 JSON from `/start`, `/enqueue`, and `/preview/invalidate`.
- Nonces, hashes, or any other CSP change.
- CI workflows, `.delivery.yml`, and Worker wrangler config.
- Deploys, Cloudflare or Vercel API calls, and live secret probes.

## Acceptance

- `GET` or `POST /start`, `POST /enqueue`, and `POST /preview/invalidate` return 401 when `env.CRON_SECRET` is missing, empty, or not an exact bearer match, including when `process.env.CRON_SECRET` would match the header.
- An exact bearer match still reaches the existing handler (fixture `/start` returns 200).
- Equal-length mismatches call `node:crypto` `timingSafeEqual`. Removing that call (plain `===`) fails the test.
- `GET /preview/health`, `GET /.well-known/deployment`, `GET /preview/identity`, and the 401 response include the six `securityHeaders`. `script-src` is `'self' 'unsafe-inline'` and contains no nonce or hash. The JSON or `Unauthorized` body is unchanged.
- The static job in `AGENTS.md` passes in a fresh detached worktree of the pull request head.
- This issue does not edit `bun.lock`, CI workflows, `.delivery.yml`, or the Worker wrangler config.
