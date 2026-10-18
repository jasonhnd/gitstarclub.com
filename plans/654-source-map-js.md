# Issue 654: Pin source-map-js to 1.2.2

## Goal

Make the mandatory web dependency audit pass on `pre`. `origin/pre` at `5af183a` resolves `source-map-js@1.2.1` in `web/bun.lock`. That release is high advisory GHSA-68fv-2mgg-jv7q (CVE-2026-93749), patched in 1.2.2. The failure blocks the required `static` check, including PR #599 and PR #640.

## Scope

1. Add `"source-map-js": "1.2.2"` to the existing `overrides` block in `web/package.json`, between the `sharp` and `undici` name pins.
2. Refresh `web/bun.lock` with Bun 1.3.14 so the lockfile records `source-map-js@1.2.2` only. The parent ranges in `postcss@8.5.28` and `@tailwindcss/node@4.3.3` stay `^1.2.1`.
3. This plan.

## Out of scope

- Any other dependency, including pipeline packages, Next.js, OpenNext, postcss, and Tailwind.
- Push to `main` or `pre`. Merge. Force-push. Deleting branches or files outside this issue.
- Wrangler write commands, Cloudflare or Vercel API calls, schedules, DNS, routes, or secrets.
- CI workflows, `.delivery.yml`, the Worker wrangler config, and deploy scripts.
- Production cron or refresh endpoints.
- Rebasing PR #599 or PR #640. Those pull requests can rebase after this pin lands on `pre`.

## Why this pin

`postcss@8.5.28` and `@tailwindcss/node@4.3.3` both depend on `source-map-js` `^1.2.1`. The lockfile selected 1.2.1. GHSA-68fv-2mgg-jv7q affects `source-map-js` `>=1.0.0, <1.2.2`: the library does not validate the per-section offset line in an indexed source map, and a very large offset can block the event loop. 1.2.2 is the patched release. An override keeps the direct dependency set unchanged.

## Acceptance

- `cd web && bun run audit:deps` exits 0 (`bun audit --audit-level=high`).
- `git grep -n 'source-map-js@1.2.1' web/bun.lock` returns nothing.
- `web/bun.lock` still resolves `postcss@8.5.28` and `@tailwindcss/node@4.3.3`.
- The AGENTS.md static job, fixture production build, and `cf:dry-run` pass on a fresh detached worktree of this head. No deploy.
- The pull request into `pre` contains `Closes #654`. This plan does not merge that pull request.
