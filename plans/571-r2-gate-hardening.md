# Harden R2 CI gates (#571)

## Goal

Close the #568 review carry-over before the production R2 cutover (I-5b). The CI gate and the build public-read check must reject a crossed or drifted store config, including a production hostname written in a different case, and a loopback fixture whose URL hostname is `[::1]`.

## Scope

- `scripts/cf-ci-gates.mjs` and `scripts/cf-ci-gates.test.mjs`
- `web/scripts/cf-opennext-build.ts` (loopback hostname)
- Stale comments in `workers/gitstarclub-web/wrangler.jsonc` and `web/lib/runtime-config.ts`
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
- `git grep` finds neither `Same store as env.pre` nor `pre sets MIN_TRACKED_STARS=1000`.
