# Review of issue 853

Verdict: APPROVE

Source review of product commit `0440856e561a84a183163cdf951959e1461b8ef5` is APPROVE. The documentation diff repairs the ten reported references, keeps the historical failures as failures, and leaves the checker, tests, allowlists, runtime, locks, and CI byte-identical to the base.

Aggregate static is FAILED. The only failing required stage is the pipeline dependency audit. That failure is unchanged from the base manifests and locks. It is a release and integration blocker. This APPROVE does not authorize merge, push, or release. Integration stays frozen.

## Identity

- Reviewed product commit: `0440856e561a84a183163cdf951959e1461b8ef5`
- Reviewed product tree: `66374e7d55eb3767a73bb90b9b2e5cc973755910`
- Required base: `179e4682325acdc742ea69d2452d292f8175ac50`
- Branch: `ib/gsc-853-review2`
- Review carrier HEAD before this final report commit: `8f4e49cc9b8385a03f2fe85f25eb0d5c8ab089af`
- Review carrier tree before this final report commit: `bad317693e874cd218645f8c194cd52e9ae20e6b`
- The review HEAD is only a report carrier. It is not the product candidate.
- `git diff 0440856e561a84a183163cdf951959e1461b8ef5 HEAD -- . ':!REVIEW.md'` was empty before this final report commit, and the worktree diff of the same pathspec was empty. No lockfile was restored because none changed. `git status --porcelain` was empty after the gates.

## Must

None for the source diff.

Release blocker, separate from this source verdict: `pipeline` `bun audit --audit-level=high` exits 1. The audit reports 4 high findings and no other required stage failed.

- `undici@6.28.1` through `@vercel/blob`: GHSA-xjj6-f33q-929c, GHSA-2m5v-pch6-74hx, GHSA-qrxm-fqhp-jwvm
- `zod@4.1.11` through `@vercel/blob > @vercel/oidc > @vercel/cli-config`: GHSA-mrhx-c7xc-m3w5

`pipeline/package.json` and `pipeline/bun.lock` blobs are equal to the base. This review did not import PR852 and did not change dependencies. The brief says those advisories are fixed only in that separate PR.

## Should

None.

## Nits

The ten links use the labels "performance runner" and "performance metrics". The path is in the URL, and each URL resolves to the maintained file. In `plans/779-footer-date-rework.md`, the word "fails" (1 occurrence) became "failed" inside the new past-tense sentence. The sentence still says documentation validation failed and that no new reference error was introduced.

## Per-file scope

Only these six paths differ from the base. `git diff --check` exit 0.

| File | Verdict | What changed |
| --- | --- | --- |
| `plans/760-astro-preview-deploy-guard.md` | APPROVE | One historical sentence. Present-tense "is not green" / "fail" became "was not green" / "failed" at the recorded time. Two backtick paths became links. Line `:24`, `undici`, and `zod` remain. |
| `plans/779-footer-date-rework.md` | APPROVE | The four-reference failure is still a failure, now "at the recorded time". Count four remains. Measurements around it were not edited. |
| `plans/781-public-refresh-releases.md` | APPROVE | The lint row stays BLOCKED, now "at the recorded time", still four references. |
| `plans/824e-rollback-follow-up.md` | APPROVE | The lint bullet stays blocked, now "at the recorded time", still eight references. `2,402`, `49 skipped`, `90.47%`, and `91.05%` are untouched. |
| `plans/astro-accept-1-baseline.md` | APPROVE | The inline `astro/scripts/perf-local.ts` and `astro/scripts/perf-metrics.ts` became the same two links. The measurement paragraph is otherwise unchanged, including seven paths, five samples, and 1440 x 1000. |
| `plans/853-performance-references.md` | APPROVE | New English task plan with goal, scope, exclusions, and acceptance. It says `Refs #853` and does not say `Closes`. |

No other tracked file differs from the base. These blobs match the base exactly: `scripts/check-docs.mjs`, `scripts/check-docs.test.mjs`, `scripts/check-coverage-threshold.mjs` (`COVERAGE_THRESHOLD` remains 0.8), `scripts/cf-ci-gates.mjs`, `scripts/cf-ci-gates.test.mjs`, `scripts/assert-cf-ci-gates.mjs`, `scripts/assert-runtime-versions.mjs`, `.github/workflows/ci.yml`, `AGENTS.md`, root and `web`/`pipeline`/`astro` `package.json` and `bun.lock` files, and `.node-version`. No allowlist entry, suppression, or checker rewrite was added.

## Historical preservation

On the base, the unchanged `extractRepoReferences` returns `scripts/perf-local.ts` and `scripts/perf-metrics.ts` from each of the five plans, ten references. For the baseline plan that already spelled `` `astro/scripts/perf-local.ts` ``, the scanner still returns the embedded `scripts/perf-local.ts` substring. A direct Node call on that sentence returns `["scripts/perf-local.ts", "scripts/perf-metrics.ts"]`. The same call on the Markdown link form returns `[]`. Neither root path exists. Both `astro/scripts/perf-local.ts` and `astro/scripts/perf-metrics.ts` exist and are the maintained files.

The candidate does not turn a recorded failure into a pass. The edited sentences still say the static job was not green, documentation lint failed or was BLOCKED, and the references were unresolved at the recorded time. Counts four, eight, and line 24 stay. The negative-path tests in `scripts/check-docs.test.mjs` are byte-identical to the base and passed here (50 tests, 0 failed), including the full-width comma and semicolon stop and the CJK punctuation cases.

## Ten targets

Each after-link was resolved from its plan file. All ten exist and match the intended file. There are no placeholder files.

| # | Document | Before, extracted on the base | After link | Exists and is the intended file |
| --- | --- | --- | --- | --- |
| 1 | `plans/760-astro-preview-deploy-guard.md` | `scripts/perf-local.ts` (missing at repo root) | `../astro/scripts/perf-local.ts` | yes, `astro/scripts/perf-local.ts` |
| 2 | `plans/760-astro-preview-deploy-guard.md` | `scripts/perf-metrics.ts` (missing at repo root) | `../astro/scripts/perf-metrics.ts` | yes, `astro/scripts/perf-metrics.ts` |
| 3 | `plans/779-footer-date-rework.md` | `scripts/perf-local.ts` (missing at repo root) | `../astro/scripts/perf-local.ts` | yes, `astro/scripts/perf-local.ts` |
| 4 | `plans/779-footer-date-rework.md` | `scripts/perf-metrics.ts` (missing at repo root) | `../astro/scripts/perf-metrics.ts` | yes, `astro/scripts/perf-metrics.ts` |
| 5 | `plans/781-public-refresh-releases.md` | `scripts/perf-local.ts` (missing at repo root) | `../astro/scripts/perf-local.ts` | yes, `astro/scripts/perf-local.ts` |
| 6 | `plans/781-public-refresh-releases.md` | `scripts/perf-metrics.ts` (missing at repo root) | `../astro/scripts/perf-metrics.ts` | yes, `astro/scripts/perf-metrics.ts` |
| 7 | `plans/824e-rollback-follow-up.md` | `scripts/perf-local.ts` (missing at repo root) | `../astro/scripts/perf-local.ts` | yes, `astro/scripts/perf-local.ts` |
| 8 | `plans/824e-rollback-follow-up.md` | `scripts/perf-metrics.ts` (missing at repo root) | `../astro/scripts/perf-metrics.ts` | yes, `astro/scripts/perf-metrics.ts` |
| 9 | `plans/astro-accept-1-baseline.md` | `scripts/perf-local.ts` embedded inside `` `astro/scripts/perf-local.ts` `` | `../astro/scripts/perf-local.ts` | yes, `astro/scripts/perf-local.ts` |
| 10 | `plans/astro-accept-1-baseline.md` | `scripts/perf-metrics.ts` embedded inside `` `astro/scripts/perf-metrics.ts` `` | `../astro/scripts/perf-metrics.ts` | yes, `astro/scripts/perf-metrics.ts` |

After the change, those five documents contain no backtick `scripts/perf-local.ts` or `scripts/perf-metrics.ts` hits.

## Gates

Toolchain: checksum-verified Node v24.20.0 (`node-v24.20.0-linux-x64.tar.gz: OK`) and Bun 1.4.2 (`bun-linux-x64.zip: OK`). `node scripts/assert-runtime-versions.mjs` printed `runtime contract satisfied: Node v24.20.0; Bun 1.4.2`. `TMPDIR` and `KANBAN_TMP` were `$HOME` (`/data/home`), so `/data/home/w` is a child of the scratch root. Clean `env -i` with no `RUN_LIVE_SMOKE`, `RELEASE_GATE_REQUIRE_LIVE`, `LIVE_SMOKE_SITE_URL`, `RELEASE_GATE_SITE`, or `RELEASE_GATE_BLOB_BASE`. Offline tests used `BLOB_BASE_URL=https://blob.example.com` and `SEO_LIVE_BASE=''`. The fixture used `http://127.0.0.1:4010` and accepts only GET and HEAD. No Edge browser and no port 9333.

The maintained fixture commands are the web package scripts `build:production`, `build:pre`, and `validate:host`, matching `.github/workflows/ci.yml` and the AGENTS local-build block. `validate:graph` is `web` `bun scripts/check-host-graph.ts`. The `astro` package was not installed because those commands do not use it. Production was validated before the pre rebuild. No generated tree was deleted. No deployment.

| Stage | Exit | Duration (s) | Counts |
| --- | --- | --- | --- |
| bootstrap | 0 | 3.247 | Node v24.20.0, Bun 1.4.2, both archives OK |
| extractor confirm (Node import of `extractRepoReferences`) | 0 | 0.055 | 10 base hits; 0 head backtick hits; embedded sample returns both `scripts/` paths; link sample returns none |
| assert runtime | 0 | 0.031 | contract satisfied |
| web frozen install | 0 | 4.134 | 536 packages installed |
| web audit (`bun audit --audit-level=high`) | 0 | 0.291 | 587 packages checked, no high findings, 4 below the high threshold (names not printed at this level) |
| web `validate:graph` | 0 | 0.009 | 681 nodes, exact pins, no legacy CLI or adapter |
| CF CI gate assertion | 0 | 0.046 | pre worker `gitstarclub-web-pre`; production scheduled triggers absent; no live deploy |
| pipeline frozen install | 0 | 0.327 | 36 packages installed |
| pipeline audit | 1 | 0.194 | 4 high: `undici@6.28.1` (3) and `zod@4.1.11` (1). See Must. |
| pipeline tests (`bun run test`) | 0 | 42.034 | 211 pass, 0 fail, 1352 expect() calls, 12 files |
| full `bun run lint:docs` | 0 | 0.343 | fences, then 50 node tests pass / 0 fail, consistency message, CF gate ok |
| `lint:md` alone | 0 | 0.017 | no findings printed |
| `node --test scripts/check-docs.test.mjs scripts/cf-ci-gates.test.mjs` | 0 | 0.211 | 50 tests, 50 pass, 0 fail, 3 suites |
| `bun scripts/check-docs.mjs` | 0 | 0.043 | references, environment inventory, and maintained facts consistent |
| final CF gate assertion inside the docs chain | 0 | 0.050 | same ok line as the earlier assertion |
| web lint | 0 | 11.111 | 0 errors, 14 warnings |
| web typecheck | 0 | 6.938 | exit 0 |
| web typecheck:tests | 0 | 7.803 | exit 0 |
| web typecheck:scripts | 0 | 1.578 | exit 0 |
| view fixture validation | 0 | 0.051 | discovered 15, validated 15, allowlisted 0, skipped 0, failed 0 |
| web `test:cov` | 0 | 147.165 | 2673 pass, 49 skip, 0 fail, 2722 tests, 225 files, 189518 expect() calls; lines 90.53%, functions 91.12%; 80% floor unchanged |
| output guard read | 0 | 0 | recorded before either build |
| fixture health | 0 | 0 | `127.0.0.1:4010/_health` ready |
| web `build:production` | 0 | 12.438 | build complete; prerendered 234 routes (31 skipped) |
| `validate:host --mode production` | 0 | 0.033 | 234 routes, 467 artifacts |
| web `build:pre` | 0 | 10.151 | build complete; prerendered 234 routes (31 skipped) |
| `validate:host --mode pre` | 0 | 0.025 | 234 routes, 467 artifacts |

Host validation stamps the git HEAD that was checked out during the build, which was the review carrier `8f4e49cc9b8385a03f2fe85f25eb0d5c8ab089af` (product tree plus `REVIEW.md` only).

Aggregate static: FAILED, only because pipeline audit exited 1. Docs full chain passed. Coverage floor passed. Both fixture modes passed.

## Unknowns

- The web audit did not name the 4 findings below `--audit-level=high`.
- The 14 lint warnings were not re-run on the base. No product code file changed.
- PR852 was not checked out or tested.
- The `astro` package install and Astro `build:production` / `build:pre` were not run. The CI and AGENTS fixture path used here is the web Vite build plus `scripts/ci-build-fixture-server.ts`.

Logs and `summary.json` are under `/data/home/evidence`. The replay command is `python3 /data/home/evidence/run-checks.py`.
