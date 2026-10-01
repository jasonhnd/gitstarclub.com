# Worker shell auth and security headers (#603)

## Goal

The Worker shell compares `CRON_SECRET` with the shared constant-time bearer helper, and it rejects a missing Worker secret with 401. Direct shell responses for `GET /preview/health`, `GET /.well-known/deployment` (and the same identity response), and 401s carry the site security headers. CSP stays `script-src 'self' 'unsafe-inline'` with no nonce or hash.

## Scope

- Worker shell `shell.ts` under `workers/gitstarclub-web/`: replace the local string-equality bearer check with `hasValidBearerToken` from `web/lib/security.ts`. A missing or empty `env.CRON_SECRET` fails closed and does not fall through to `process.env.CRON_SECRET`. Apply `securityHeaders` from `web/lib/csp.ts` to the public health and deployment responses and to the 401 response.
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

## PR #627 integration refresh (GSC_0060)

Goal: merge the latest `origin/pre` into `fix/603-worker-shell-hardening` with a merge commit, preserving the reviewed #603 behavior and upstream changes without rewriting history.

Scope: resolve any merge conflicts in the existing implementation and update this plan and the PR verification record. Preserve upstream shell identity, cron dispatch, queue advancement, and refresh behavior alongside the shared constant-time bearer check, missing-secret rejection, and public/401 security headers.

Out of scope: new features, rebases, force pushes, PR merges, protected-branch pushes, deployments, provider API calls, credential reads, and authored changes to CI, `.delivery.yml`, or wrangler configuration. Existing upstream changes are brought in by the merge.

Acceptance: the original PR head remains an ancestor; the fetched `origin/pre` is a merge parent; the complete static job and shell-related tests pass at the new head in a fresh detached worktree; PR #627 reports no merge conflicts and its verification record names the tested head. Temporary verification files and logs stay under `/tmp/GSC_0060/`, and the task checkout is clean at handoff.

Integration result: the fetched base is `5ab838656eb0d67ac775d5fcf8c0aa67cf83ba6c`. PR #616 is still open and is not part of that base. The only merge conflict is the adjacent `Changed` entries in `docs/CHANGELOG.md`; retain both the #603 hardening entry and the upstream #592 runtime update entry. `shell.ts` has no merge conflict and remains byte-for-byte identical to the reviewed PR head, including identity priority, cron dispatch, refresh and queue behavior, constant-time auth, missing-secret rejection, and security headers.
