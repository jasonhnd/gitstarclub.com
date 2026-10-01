# Harden R2 CI gates (#571)

## Goal

Close the #568 review carry-over before the production R2 cutover (I-5b). The CI gate and the build public-read check must reject a crossed or drifted store config, including a production hostname written in a different case, and a loopback fixture whose URL hostname is `[::1]`.

## Scope

- `scripts/cf-ci-gates.mjs` and `scripts/cf-ci-gates.test.mjs`
- `web/scripts/cf-opennext-build.ts` (loopback hostname)
- Stale comments in workers/gitstarclub-web/wrangler.jsonc and `web/lib/runtime-config.ts`
- This plan

## Out of scope

- Wrangler values: buckets, domains, `DEPLOY_ENV`, drivers, crons, and bindings stay as they are on `pre`
- Deploys, Cloudflare or Vercel API calls, and `wrangler` writes
- `scripts/assert-cf-ci-gates.mjs` behavior (it already calls the gate)

## Acceptance

- Host mentions of `data.gitstarclub.com` and `data-pre.gitstarclub.com` compare case-insensitively. `DATA.gitstarclub.com` inside `env.pre` fails the gate.
- Negative tests cover a wrong or missing preview `STORAGE_*_DRIVER`, `R2_BUCKET`, and `R2_PUBLIC_BASE_URL`, plus preview naming the production bucket or domain and the top level naming the preview bucket or domain.
- Top-level `DEPLOY_ENV` stays unset until cutover. Top-level `STORAGE_READ_DRIVER`, `READ_DRIVER`, `STORAGE_WRITE_DRIVER`, and `WRITE_DRIVER` stay unset or `blob`. Any other value fails. The current `pre` wrangler config passes.
- `http://[::1]:4010` is a local public-read fixture. `url.hostname` is `[::1]`, so a comparison with `::1` does not match.
- The production Blob comment no longer claims it shares a store with preview, and the membership-floor comment no longer claims preview uses a 1k floor.

## Verification

Checked commit `7cce5be` in a fresh detached worktree that did not contain a web env local file or a pipeline env file. Node v24.20.0 and Bun 1.3.14, under `env -i`. SEO_LIVE_BASE was empty. The web test step set RUN_LIVE_SMOKE to 0.

| Step | Result |
| --- | --- |
| `node scripts/assert-runtime-versions.mjs` and `node scripts/assert-cf-ci-gates.mjs` | pass |
| `web` `bun install --frozen-lockfile` | pass |
| `web` `bun run audit:deps` | fail, 7 vulnerabilities (1 critical, 6 high). Lockfiles unchanged. Tracked in #584 |
| `pipeline` install and `bun run test` | install pass; 24 pass / 0 fail |
| `pipeline` `bun run audit:deps` | fail, 1 high (`undici`). Tracked in #584 |
| `bun run lint:docs` | fail on `7cce5be`: this plan's backticked Worker config path was parsed as a missing web path. Backticks removed; re-run with Bun 1.3.14 passed (36 pass / 0 fail) |
| `web` `bun run lint` | pass, 0 errors, 14 existing warnings |
| `typecheck`, `typecheck:tests`, `typecheck:scripts` | pass |
| `validate:views` | pass |
| `BLOB_BASE_URL=https://blob.example.com SEO_LIVE_BASE="" bun run test:cov` | pass, 1395 pass / 49 skip / 0 fail; coverage gate lines 86.38%, functions 86.86% |
| `SEO_LIVE_BASE="" RUN_LIVE_SMOKE=0 bun run test` | pass, 1395 pass / 49 skip / 0 fail |
| `bun run build` against the loopback fixture | pass |
| `bun run cf:dry-run` | pass, dry-run exited before upload. Build identity `7cce5be` |

GitHub Actions run 36810127421 fails `static` at `web` `audit:deps`, so `production-build` was skipped. Do not weaken the audit in this pull request. Rerun `static` and `production-build` after #584 lands.
