# AGENTS

Cursor subagent definitions for this repository live in `.cursor/agents/`.

Branch and merge policy is owned by `.grok/rules/pre-only.md`. Required CI checks and the delivery pipeline are owned by `.delivery.yml`. This file restates those rules. `.grok/rules/pre-only.md` and `.delivery.yml` stay in place and must stay consistent with this file.

This repository currently has no root `WORKFLOW.md`. Follow pre-only plus `.delivery.yml`.

## Executable rules

1. Name each spawned agent `[role][project] task`.
2. In output for Jason, the first time a term appears, explain it in plain language.
3. Do not merge to `main` automatically. Merging to `pre` is allowed.
4. Write each task plan as markdown under `plans/`.
5. All repository text, code comments, commits, issues, and pull requests are English. The exception is product locale copy for the non-English site locales ja, zh, zh-TW, ko, es, and fr, on the CJK-gate allowlist: `web/lib/i18n/dictionaries/`, `web/lib/i18n/locales.ts`, `web/app/_localized/`, `web/lib/format.ts`, `web/lib/narrative.ts`, `web/lib/shareable-snippets.ts`, `web/lib/format.test.ts`, `web/lib/narrative.test.ts`, `web/lib/shareable-snippets.test.ts`, `web/lib/geo-capsules.test.ts`, `web/lib/pulse-board-links.test.tsx`, `web/lib/rank-period-labels.test.ts`, `web/lib/rankings-archive.test.ts`, and `web/e2e/routing-security.spec.ts`.

## Branches

`pre` is the integration branch. Every feature branch and every pull request is based on `pre`. `main` is production.

Promotion is a separate pull request from `pre` to `main`. Merge that pull request with a merge commit so `Closes #N` keeps working. Open it only when the owner explicitly says "push main", "push to main", or "promote to main".

Never push directly to `pre` or `main`. The ruleset `release gates (pre/main)` requires a pull request, blocks a force-push, and blocks deleting those branches. Do not target `main`, cherry-pick onto `main`, merge into `main`, or push `main` unless the owner explicitly orders it. Do not hotfix production by calling production cron. Land on `pre` and wait.

Required status checks are `static` and `production-build` (the job names in `.github/workflows/ci.yml`; `.delivery.yml` lists the same two). `preview-e2e`, `product-gates`, `cf-preview`, and `cf-workers-host` are optional. Do not make them required.

Feature pull requests into `pre` are squash-merged by the reviewer or owner, never by the executor. Executable rule 3 still stands for that reviewer or owner: merging to `pre` is allowed, and merging to `main` is not automatic.

## Delivery

One issue, one branch, one pull request against `pre`.

The pull request body contains `Closes #N`, what changed, the verification commands that were run and their results, and anything unfinished or uncertain.

Commit after each completed step. Use a conventional commit subject: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`, `perf:`, or `ci:`.

Write the task plan as markdown under `plans/` (executable rule 4). A plan states the goal, the scope, what is out of scope, and acceptance.

## Forbidden for executors

- Force-push.
- Delete branches, or delete files outside the issue scope.
- Merge any pull request.
- Push to `pre` or `main`.
- Live `wrangler deploy` or `wrangler versions upload`.
- Change Cloudflare schedules, DNS, routes, or secrets.
- Call production cron or refresh endpoints, including `gitstarclub.com/api/cron/*`.
- Edit CI workflows, `.delivery.yml`, the Worker wrangler config, or deploy scripts unless the issue explicitly asks.
- Commit incidental `bun.lock` churn from `bun install`.
- Commit secrets, tokens, or real environment values.

## Verification commands

Run these with Node 24 (`.node-version`) and Bun 1.3.14 (root `packageManager`). The machine default often fails the check (this host's global Bun was 1.4.0: expected 1.3.14). Put the pinned binaries on `PATH` for the current shell with the block under "Pinned runtime". Do not change the global install. Each block below was run on this contract branch on 2026-09-25 and passed. Durations are wall time on that run. Install and `audit:deps` need network. Empty `SEO_LIVE_BASE` skips the live SEO file only. It does not keep the suite off the network. `web/lib/integration/live-smoke.test.ts` calls `readBlobBase()` before it looks at `RUN_LIVE_SMOKE`. That helper reads web/.env.local. When the file contains a Blob base, the suite fetches the hard-coded production site. Run the suite from a checkout with no web/.env.local (move the file aside when it exists) and with `RUN_LIVE_SMOKE` unset. Those steps are in the `web/` test block below.

A full `web/` suite is the verification bar. A single test file is not.

Every later block assumes this shell. Run the pinned-runtime block first.

### Pinned runtime

Session only. The binaries land under `$TMPDIR/gitstarclub-runtime` (or `/tmp/gitstarclub-runtime` when `TMPDIR` is unset). This does not replace the global Node or Bun, and it does not edit the shell profile. Do not pipe `https://bun.sh/install` into a shell: that installer appends a `PATH` line to the shell rc. This block downloads the Node 24.20.0 tarball and the Bun 1.3.14 release zip instead. On this Darwin arm64 host it printed Node v24.20.0 and Bun 1.3.14, then `runtime contract satisfied`. The other platform arms use the same release names and were not executed here.

```bash
runtime_root="${TMPDIR:-/tmp}/gitstarclub-runtime"
mkdir -p "$runtime_root"
node_ver="v24.20.0"
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
mach="$(uname -m)"
case "$mach" in
  arm64|aarch64) node_arch="arm64" ;;
  x86_64) node_arch="x64" ;;
  *) echo "unsupported machine: $mach" >&2; exit 1 ;;
esac
case "$os" in
  darwin|linux) ;;
  *) echo "unsupported os: $os" >&2; exit 1 ;;
esac
node_dist="node-${node_ver}-${os}-${node_arch}"
node_dir="$runtime_root/$node_dist"
if [ ! -x "$node_dir/bin/node" ]; then
  curl -fsSL "https://nodejs.org/dist/${node_ver}/${node_dist}.tar.gz" -o "$runtime_root/${node_dist}.tar.gz"
  tar -xzf "$runtime_root/${node_dist}.tar.gz" -C "$runtime_root"
fi
case "${os}-${mach}" in
  darwin-arm64) bun_asset="bun-darwin-aarch64" ;;
  darwin-x86_64) bun_asset="bun-darwin-x64" ;;
  linux-x86_64) bun_asset="bun-linux-x64" ;;
  linux-aarch64|linux-arm64) bun_asset="bun-linux-aarch64" ;;
  *) echo "unsupported bun platform: ${os}-${mach}" >&2; exit 1 ;;
esac
bun_dir="$runtime_root/$bun_asset"
if [ ! -x "$bun_dir/bun" ]; then
  curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/${bun_asset}.zip" -o "$runtime_root/${bun_asset}.zip"
  unzip -q -o "$runtime_root/${bun_asset}.zip" -d "$runtime_root"
fi
export PATH="$node_dir/bin:$bun_dir:$PATH"
hash -r
node --version
bun --version
node scripts/assert-runtime-versions.mjs
```

Run that from the repo root. Later blocks in this file use the same shell.

### Repository root

No network. On the passing run, all three finished in under a second (`lint:docs` about 0.4s).

```bash
node scripts/assert-runtime-versions.mjs
node scripts/assert-cf-ci-gates.mjs
bun run lint:docs
```

`assert-runtime-versions` prints `runtime contract satisfied` for Node 24.x and Bun 1.3.14. `assert-cf-ci-gates` checks the preview Worker name, an empty production cron list, and that automation does not live-deploy. `lint:docs` checks Markdown fences, docs contracts, the CJK gate, and the same CF gates.

### `web/`

```bash
bun install --frozen-lockfile
bun run audit:deps
bun run lint
bun run typecheck
bun run typecheck:tests
bun run typecheck:scripts
bun run validate:views -- scripts/fixtures/views
```

Then, still from the repo root, run the suite only after moving web/.env.local aside and unsetting `RUN_LIVE_SMOKE`. Restore the file on the way out. `BLOB_BASE_URL=https://blob.example.com` is a public placeholder, not a live store. Do not replace it with a real Blob URL.

```bash
aside="${TMPDIR:-/tmp}/gitstarclub-web-env-local-aside"
root="$(pwd)"
moved=0
if [ -e "$root/web/.env.local" ]; then
  mv "$root/web/.env.local" "$aside"
  moved=1
fi
cleanup() {
  if [ "$moved" = 1 ] && [ -e "$aside" ]; then
    mv "$aside" "$root/web/.env.local"
  fi
}
trap cleanup EXIT
unset RUN_LIVE_SMOKE
(
  cd "$root/web"
  BLOB_BASE_URL=https://blob.example.com SEO_LIVE_BASE= bun run test
  BLOB_BASE_URL=https://blob.example.com SEO_LIVE_BASE= bun run test:cov
)
status=$?
cleanup
trap - EXIT
exit "$status"
```

`test:cov` is `bun test lib/ --coverage --isolate` plus `scripts/check-coverage-threshold.mjs` (line and function coverage at least 80%). Observed: install about 1s (658 packages); audit under 1s with no high advisory; lint about 6s (0 errors); typecheck about 5s, tests about 3s, scripts about 1s; view validation under 1s (`discovered 15; validated 15; failed 0`); `test` about 25s (1304 pass, 49 skip, 0 fail, 1353 tests, 162 files); `test:cov` about 25s with the same counts and coverage lines 86.36%, functions 86.10%.

Restore `web/bun.lock` if `bun install` changes it. Do not commit that churn.

### `pipeline/`

```bash
bun install --frozen-lockfile
bun run audit:deps
bun run test
```

Observed: install about 41ms (35 packages); audit about 1s, exit 0; tests about 21ms (9 pass, 0 fail). Restore `pipeline/bun.lock` if the install changes it.

### Production build

This matches the `production-build` job: a GET/HEAD-only fixture, then `bun run build` in `web/`. Do not export a Blob write credential (`BLOB_READ_WRITE_TOKEN` must be unset). No real Blob URL.

```bash
cd web
export BLOB_BASE_URL=http://127.0.0.1:4010
bun scripts/ci-build-fixture-server.ts > /tmp/ci-build-fixture.log 2>&1 &
fixture_pid=$!
trap 'kill "$fixture_pid" 2>/dev/null || true' EXIT
for attempt in $(seq 1 20); do
  if curl --fail --silent "$BLOB_BASE_URL/_health" > /dev/null; then
    bun run build
    exit $?
  fi
  sleep 1
done
echo "fixture did not become ready" >&2
exit 1
```

The fixture listens on `127.0.0.1:4010`, returns 404 for views, and rejects any method other than GET or HEAD. The app build must tolerate those missing views. Observed: about 14s, Next.js 16.3.5, 248 static pages, exit 0. Localhost only.

### Cloudflare build

`cf:dry-run` is `cf:build:pre` and then `node ../scripts/cf-wrangler-dry-run.mjs`. That wrapper is `wrangler deploy --dry-run` for wrangler env `pre` only. It must not target the production Worker, and it must not drop `--dry-run`. Do not deploy. Do not run `wrangler versions upload`.

Needs `BLOB_BASE_URL`. The successful local run used the same fixture as the production build (`http://127.0.0.1:4010`). The public placeholder, when a command needs a Blob base and is not using that fixture, is `https://blob.example.com`. Never a real store URL. `cf:build:pre` sets `SITE_INDEXABLE=0` itself. The optional CI job also sets `HOSTING_TARGET=cf` and `NODE_OPTIONS=--max-old-space-size=8192`; this run set both.

```bash
cd web
export BLOB_BASE_URL=http://127.0.0.1:4010
export HOSTING_TARGET=cf
export NODE_OPTIONS=--max-old-space-size=8192
bun scripts/ci-build-fixture-server.ts > /tmp/ci-build-fixture.log 2>&1 &
fixture_pid=$!
trap 'kill "$fixture_pid" 2>/dev/null || true' EXIT
for attempt in $(seq 1 20); do
  if curl --fail --silent "$BLOB_BASE_URL/_health" > /dev/null; then
    bun run cf:dry-run
    exit $?
  fi
  sleep 1
done
echo "fixture did not become ready" >&2
exit 1
```

Observed: about 18s. `cf:build:pre` printed `cf:build pre indexing self-check passed`. Wrangler printed `--dry-run: exiting now`. Nothing was deployed.

`cf:build` must be given `--site-target=production` or `--site-target=pre`. Production output is indexable. Preview (`pre`) output is `noindex`.

## Repository constraints

Language. The English-only policy is executable rule 5. It covers repository text, code comments, commits, issues, and pull requests. Site locales are `en`, `ja`, `zh`, `zh-TW`, `ko`, `es`, and `fr`. Non-English product copy is allowed only for ja, zh, zh-TW, ko, es, and fr, and only on the paths rule 5 lists.

The automated check is narrower than that policy. `checkCjkProse` in `scripts/check-docs.mjs` walks only `docs/`, `plans/`, `.cursor/`, `.grok/`, and `AGENTS.md`. The pattern matches Han ideographs in U+4E00 through U+9FFF, the full-width marks U+3001, U+3002, U+300A, U+300B, U+300C, U+300D, U+3010, U+3011, U+FF01, U+FF08, U+FF09, U+FF0C, U+FF1A, U+FF1B, and U+FF1F, and a double em dash. It does not match hiragana, katakana, or hangul. A single em dash stays allowed. The same function skips the allowlist in rule 5, including the locale helpers `web/lib/format.ts`, `web/lib/narrative.ts`, and `web/lib/shareable-snippets.ts`, so a wider walk would still skip them. Those paths are outside the directories the check walks today. `bun run lint:docs` runs this check. A green run does not prove the rest of the tree is English.

Product. Pages are fully prerendered static HTML plus small client islands. All data comes from precomputed JSON. There is no runtime AI, no runtime database, and no live search. Output is deterministic. Content pages stay near-zero client JavaScript. Do not add pages unless the issue says so. Follow `docs/GEO.md`.

Reader-facing copy, in every language, does not mention Blob, rank JSON, lookup JSON, or server routes. Keep the signals that the page is precomputed, deterministic, and not live search or AI.

Design. The Material 3 accent is amber `#F2A900`. Data stars always use the `Star` component in `web/app/_explore/Star.tsx`. Do not hand-write a star glyph.

CSP. Production `script-src` stays `'self' 'unsafe-inline'` (`web/lib/csp.ts`). Do not "harden" it with nonces or hashes. Both break hydration on this prerendered site.

Language switcher. Links go through `/api/lang?lang=…&next=…` (`web/app/components/LanguageSwitcher.tsx`). Do not point them at localized paths directly.

Ranking periods. Navigation and sitemap periods come from `resolveAvailableRankPeriods` in `web/lib/data/rank-periods.ts` (data that exists), never from calendar math. Historical sitemap periods come from `meta.folded_through` (`web/lib/sitemap.ts`).

Tests. Bun `mock.module` is process-global. Never mock `@/lib/periods`. Never replace `globalThis.fetch` without restoring it. A change is verified only when the full `web/` suite passes, not when one file passes.

Indexing. Production builds are indexable. Preview (`pre`) builds are `noindex`. Pass `--site-target=production` or `--site-target=pre` to `cf:build`.

UI or visual changes need before and after screenshots in the pull request. The owner signs off before merge. Code or design changes update the relevant docs in the same pull request.

Legal and compliance wording is not defined for this repository. Do not invent any.

## Work autonomously

Work autonomously. Do not stop to ask questions; no one will answer.
