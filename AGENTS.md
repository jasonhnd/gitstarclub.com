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

Run the static job from `.github/workflows/ci.yml` on the commit under test. Use Node 24 (`.node-version`; the tarball below is v24.20.0) and Bun 1.3.14 (root `packageManager`). A full `web/` suite is the bar. One test file is not.

Use a fresh detached worktree of that commit. Untracked files in the owner's checkout, including web/.env.local, are not in the new tree. Do not move or delete files there. From the checkout you are editing:

```bash
git worktree add --detach ../gsc-verify HEAD
```

Remove it from that same checkout when finished. Install and the builds leave untracked files, so removal needs `--force`:

```bash
git worktree remove --force ../gsc-verify
```

Run the two heredocs with `bash --noprofile --norc` under `env -i`. They do not use the parent shell, so zsh is fine as the parent. Each heredoc is its own process. Do not source it.

The clean environment has no inherited variables. For an offline run, do not set `RUN_LIVE_SMOKE`, `LIVE_SMOKE_SITE_URL`, `RELEASE_GATE_REQUIRE_LIVE`, `RELEASE_GATE_SITE`, or `RELEASE_GATE_BLOB_BASE`. `web/lib/integration/release-gates-live.ts` runs live checks only when `RELEASE_GATE_REQUIRE_LIVE` is `1` or `true`. `web/lib/integration/live-smoke.test.ts` reads web/.env.local before `RUN_LIVE_SMOKE` and can then fetch production; a fresh worktree has no such file, so that suite skips. `web/lib/integration/seo.test.ts` treats a missing `SEO_LIVE_BASE` as the production site, so the static block sets it to empty, which is what CI does. It also sets `BLOB_BASE_URL` to `https://blob.example.com`. That value is a placeholder. Do not replace it with a real store, and do not export a Blob write credential.

Bun reads `.env`, `.env.local`, and `.env.<NODE_ENV>` from the directory it starts in. A fresh worktree has none.

Do not pipe the Bun installer into a shell. It appends to the shell rc. The bootstrap downloads the official archives, checks SHA-256, then extracts. Node sums come from `https://nodejs.org/dist/v24.20.0/SHASUMS256.txt`. Bun sums come from the `bun-v1.3.14` release `SHASUMS256.txt`. macOS uses `shasum -a 256 -c`. Linux uses `sha256sum -c` when `shasum` is absent. The cache is `$TMPDIR/gitstarclub-toolchain/node-v24.20.0` and `$TMPDIR/gitstarclub-toolchain/bun-1.3.14`. A cached binary is used only after that run has verified its archive. If an archive checksum fails, or a cached `node` or `bun` binary does not report v24.20.0 or 1.3.14, the block prints that path and exits non-zero. It does not delete the cache. Remove the named directory by hand, then run the bootstrap again. The only deletion outside the verify worktree is `git worktree remove` of the worktree this flow created. The bootstrap also links `bunx` to `bun`, because `cf:build` and the dry-run wrapper call `bunx`.

The static block follows the CI `static` job: web install and audit, then pipeline install, audit, and test, then `lint:docs`, then web lint and the three typechecks, then view validation and `test:cov`. Pipeline packages have to be installed before `typecheck:scripts`. `test:cov` is `bun test lib/ --coverage --isolate` plus `scripts/check-coverage-threshold.mjs` (line and function coverage at least 80%). Restore a `bun.lock` if an install changes it. Do not commit that churn.

App data for the two builds comes from the local GET/HEAD fixture on `127.0.0.1:4010`. `web/app/_shell/RootShell.tsx` imports `next/font/google`, so a cold build can also download fonts. Eslint ignores `.next` and does not ignore `.open-next`. The block lints before `cf:dry-run`. `cf:dry-run` is a dry run for wrangler env `pre` only. Do not deploy. Do not run `wrangler versions upload`. `cf:build` must be given `--site-target=production` or `--site-target=pre`. Production output is indexable. Preview output is `noindex`.

### Bootstrap

```bash
env -i HOME="$HOME" PATH="/usr/bin:/bin" TMPDIR="${TMPDIR:-/tmp}" \
  bash --noprofile --norc -euo pipefail <<'SH'
tool_root="${TMPDIR}/gitstarclub-toolchain"
node_ver="v24.20.0"
bun_ver="1.3.14"
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
mach="$(uname -m)"
case "$mach" in
  arm64|aarch64) node_arch="arm64" ;;
  x86_64) node_arch="x64" ;;
  *) echo "unsupported machine: $mach" >&2; false ;;
esac
case "$os" in
  darwin|linux) ;;
  *) echo "unsupported os: $os" >&2; false ;;
esac
case "${os}-${mach}" in
  darwin-arm64) bun_asset="bun-darwin-aarch64" ;;
  darwin-x86_64) bun_asset="bun-darwin-x64" ;;
  linux-x86_64) bun_asset="bun-linux-x64" ;;
  linux-aarch64|linux-arm64) bun_asset="bun-linux-aarch64" ;;
  *) echo "unsupported bun platform: ${os}-${mach}" >&2; false ;;
esac
if command -v shasum >/dev/null 2>&1; then
  check_sum() { grep "  ${1}$" SHASUMS256.txt | shasum -a 256 -c -; }
else
  check_sum() { grep "  ${1}$" SHASUMS256.txt | sha256sum -c -; }
fi
verify_archive() {
  cache="$1"
  sums_url="$2"
  archive_url="$3"
  archive="$4"
  mkdir -p "$cache"
  (
    cd "$cache"
    if [ ! -f SHASUMS256.txt ]; then
      curl -fsSL "$sums_url" -o SHASUMS256.txt
    fi
    if [ ! -f "$archive" ]; then
      curl -fsSL "$archive_url" -o "$archive"
    fi
    if ! check_sum "$archive"; then
      echo "checksum failed: ${cache}/${archive}" >&2
      echo "remove ${cache} manually and run the bootstrap again" >&2
      false
    fi
  )
}
node_dist="node-${node_ver}-${os}-${node_arch}"
node_cache="${tool_root}/node-${node_ver}"
verify_archive "$node_cache" \
  "https://nodejs.org/dist/${node_ver}/SHASUMS256.txt" \
  "https://nodejs.org/dist/${node_ver}/${node_dist}.tar.gz" \
  "${node_dist}.tar.gz"
node_bin="${node_cache}/${node_dist}/bin/node"
if [ ! -x "$node_bin" ]; then
  tar -xzf "${node_cache}/${node_dist}.tar.gz" -C "$node_cache"
fi
if [ "$("$node_bin" --version)" != "$node_ver" ]; then
  echo "cached node failed re-verification: ${node_bin}" >&2
  false
fi
bun_cache="${tool_root}/bun-${bun_ver}"
verify_archive "$bun_cache" \
  "https://github.com/oven-sh/bun/releases/download/bun-v${bun_ver}/SHASUMS256.txt" \
  "https://github.com/oven-sh/bun/releases/download/bun-v${bun_ver}/${bun_asset}.zip" \
  "${bun_asset}.zip"
bun_bin="${bun_cache}/${bun_asset}/bun"
if [ ! -x "$bun_bin" ]; then
  unzip -q -o "${bun_cache}/${bun_asset}.zip" -d "$bun_cache"
fi
if [ "$("$bun_bin" --version)" != "$bun_ver" ]; then
  echo "cached bun failed re-verification: ${bun_bin}" >&2
  false
fi
ln -sfn bun "${bun_cache}/${bun_asset}/bunx"
export PATH="${node_cache}/${node_dist}/bin:${bun_cache}/${bun_asset}:${PATH}"
hash -r
node --version
bun --version
command -v bunx
bunx --version
SH
```

### Static job and local builds

`cd ../gsc-verify` first. The block checks the cached archives again, then runs the static job, the fixture production build, and `cf:dry-run`.

```bash
env -i HOME="$HOME" PATH="/usr/bin:/bin" TMPDIR="${TMPDIR:-/tmp}" \
  bash --noprofile --norc -euo pipefail <<'SH'
tool_root="${TMPDIR}/gitstarclub-toolchain"
node_ver="v24.20.0"
bun_ver="1.3.14"
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
mach="$(uname -m)"
case "$mach" in
  arm64|aarch64) node_arch="arm64" ;;
  x86_64) node_arch="x64" ;;
  *) echo "unsupported machine: $mach" >&2; false ;;
esac
case "${os}-${mach}" in
  darwin-arm64) bun_asset="bun-darwin-aarch64" ;;
  darwin-x86_64) bun_asset="bun-darwin-x64" ;;
  linux-x86_64) bun_asset="bun-linux-x64" ;;
  linux-aarch64|linux-arm64) bun_asset="bun-linux-aarch64" ;;
  *) echo "unsupported bun platform: ${os}-${mach}" >&2; false ;;
esac
if command -v shasum >/dev/null 2>&1; then
  check_sum() { grep "  ${1}$" SHASUMS256.txt | shasum -a 256 -c -; }
else
  check_sum() { grep "  ${1}$" SHASUMS256.txt | sha256sum -c -; }
fi
node_dist="node-${node_ver}-${os}-${node_arch}"
node_cache="${tool_root}/node-${node_ver}"
bun_cache="${tool_root}/bun-${bun_ver}"
node_bin="${node_cache}/${node_dist}/bin/node"
bun_bin="${bun_cache}/${bun_asset}/bun"
if ! ( cd "$node_cache" && check_sum "${node_dist}.tar.gz" ); then
  echo "checksum failed: ${node_cache}/${node_dist}.tar.gz" >&2
  echo "remove ${node_cache} manually and run the bootstrap again" >&2
  false
fi
if ! ( cd "$bun_cache" && check_sum "${bun_asset}.zip" ); then
  echo "checksum failed: ${bun_cache}/${bun_asset}.zip" >&2
  echo "remove ${bun_cache} manually and run the bootstrap again" >&2
  false
fi
if [ "$("$node_bin" --version)" != "$node_ver" ]; then
  echo "cached node failed re-verification: ${node_bin}" >&2
  false
fi
if [ "$("$bun_bin" --version)" != "$bun_ver" ]; then
  echo "cached bun failed re-verification: ${bun_bin}" >&2
  false
fi
export PATH="${node_cache}/${node_dist}/bin:${bun_cache}/${bun_asset}:${PATH}"
hash -r
node --version
bun --version
command -v bunx
bunx --version
node scripts/assert-runtime-versions.mjs
node scripts/assert-cf-ci-gates.mjs
( cd web && bun install --frozen-lockfile && bun run audit:deps )
( cd pipeline && bun install --frozen-lockfile && bun run audit:deps && bun run test )
bun run lint:docs
(
  cd web
  bun run lint
  bun run typecheck
  bun run typecheck:tests
  bun run typecheck:scripts
  bun run validate:views -- scripts/fixtures/views
  BLOB_BASE_URL="https://blob.example.com" SEO_LIVE_BASE="" bun run test:cov
)
start_fixture() {
  bun scripts/ci-build-fixture-server.ts >"${TMPDIR}/ci-build-fixture.log" 2>&1 &
  fixture_pid=$!
  ready=0
  for _step in $(seq 1 20); do
    if curl --fail --silent "${BLOB_BASE_URL}/_health" >/dev/null; then
      ready=1
      break
    fi
    sleep 1
  done
  if [ "$ready" != 1 ]; then
    echo "fixture did not become ready" >&2
    kill "$fixture_pid" 2>/dev/null || true
    false
  fi
}
(
  cd web
  export BLOB_BASE_URL="http://127.0.0.1:4010"
  fixture_pid=""
  trap 'if [ -n "${fixture_pid:-}" ]; then kill "$fixture_pid" 2>/dev/null || true; fi' EXIT
  start_fixture
  bun run build
)
(
  cd web
  export BLOB_BASE_URL="http://127.0.0.1:4010"
  export HOSTING_TARGET="cf"
  export NODE_OPTIONS="--max-old-space-size=8192"
  fixture_pid=""
  trap 'if [ -n "${fixture_pid:-}" ]; then kill "$fixture_pid" 2>/dev/null || true; fi' EXIT
  start_fixture
  bun run cf:dry-run
)
SH
```

## Repository constraints

Language. The English-only policy is executable rule 5. It covers repository text, code comments, commits, issues, and pull requests. Site locales are `en`, `ja`, `zh`, `zh-TW`, `ko`, `es`, and `fr`. Non-English product copy is allowed only for ja, zh, zh-TW, ko, es, and fr, and only on the paths rule 5 lists.

The automated check is narrower than that policy. `checkCjkProse` in `scripts/check-docs.mjs` walks only `docs/`, `plans/`, `.cursor/`, `.grok/`, and `AGENTS.md`. The pattern matches Han ideographs in U+4E00 through U+9FFF, the full-width marks U+3001, U+3002, U+300A, U+300B, U+300C, U+300D, U+3010, U+3011, U+FF01, U+FF08, U+FF09, U+FF0C, U+FF1A, U+FF1B, and U+FF1F, and a double em dash. It does not match hiragana, katakana, or hangul. A single em dash stays allowed. The same function skips the allowlist in rule 5, including the locale helpers `web/lib/format.ts`, `web/lib/narrative.ts`, and `web/lib/shareable-snippets.ts`, so a wider walk would still skip them. Those paths are outside the directories the check walks today. `bun run lint:docs` runs this check. A green run does not prove the rest of the tree is English.

Product. Pages are fully prerendered static HTML plus small client islands. All data comes from precomputed JSON stored in Vercel Blob. The site is hosted on Cloudflare Workers through OpenNext. There is no runtime AI, no runtime database, and no live search. Output is deterministic. Content pages stay near-zero client JavaScript. Do not add pages unless the issue says so. Follow `docs/GEO.md` for answer capsules and citation strategy. That file still says implementation must remain Vercel-first. That sentence is historical and does not choose the host.

Reader-facing copy, in every language, does not mention Blob, rank JSON, lookup JSON, or server routes. Keep the signals that the page is precomputed, deterministic, and not live search or AI.

Design. The Material 3 accent is amber `#F2A900`. Data stars always use the `Star` component in `web/app/_explore/Star.tsx`. Do not hand-write a star glyph.

CSP. Production `script-src` stays `'self' 'unsafe-inline'` (`web/lib/csp.ts`). Do not "harden" it with nonces or hashes. Both break hydration on this prerendered site.

Language switcher. Links go through `/api/lang?lang=…&next=…` (`web/app/components/LanguageSwitcher.tsx`). Do not point them at localized paths directly.

Ranking periods. Navigation periods come from `resolveAvailableRankPeriods` in `web/lib/data/rank-periods.ts` (data that exists), never from calendar math. Sitemap routes do the same: `web/lib/sitemap-routes.ts` passes `resolveAvailableRankPeriods(now)` into `buildSitemapPaths`. `publishedRankingPeriodPaths` in `web/lib/sitemap.ts` uses that resolver result when it is present, and falls back to `meta.folded_through` only when it is absent. `web/lib/sitemap.test.ts` covers both.

Tests. Bun `mock.module` is process-global. Never mock `@/lib/periods`. Never replace `globalThis.fetch` without restoring it. A change is verified only when the full `web/` suite passes, not when one file passes.

Indexing. Production builds are indexable. Preview (`pre`) builds are `noindex`. Pass `--site-target=production` or `--site-target=pre` to `cf:build`.

UI or visual changes need before and after screenshots in the pull request. The owner signs off before merge. Code or design changes update the relevant docs in the same pull request.

Legal and compliance wording is not defined for this repository. Do not invent any.

## Work autonomously

Work autonomously. Do not stop to ask questions; no one will answer.
