---
owner: bootstrap pipeline
status: draft
last_reviewed: 2026-10-22
source_of_truth_for:
  - issue 736 preview aggregate import execution evidence
---

# Preview aggregate import execution evidence

Issue #736 / card GSC_0161 executes the separately authorized preview
[operator runbook](PREVIEW-AGGREGATE-IMPORT.md). The
[plan](../../plans/736-preview-aggregate-import-execution.md) defines the
scope and acceptance. This report supplies evidence to the independent
reviewer; it does not record owner acceptance.

## Exact deployment candidate and local gate

The fresh detached shared clone checked out exact `origin/pre`
`96b618933baadab7ebb622580c3da05efbb15f5f`, containing merged PR #734.
Remote `pre` still matched immediately before the real-source build.
No owner environment files were copied. The AGENTS heredocs ran under
`env -i` and `bash --noprofile --norc -euo pipefail`. Owner overrides used the
shared toolchain archive cache and shared HOME Bun cache, with
`BUN_INSTALL_CACHE_DIR` unset. Other output stayed under this card.

The official archive bootstrap and complete static/build block both exited
0. Every command below exited 0:

| Commands | Result |
| --- | --- |
| AGENTS archive bootstrap and static archive/version recheck | SHA-256 verified; Node v24.20.0; Bun/bunx 1.4.2 |
| `node scripts/assert-runtime-versions.mjs` | Runtime contract satisfied |
| `cd web && bun install --frozen-lockfile && bun run audit:deps && bun run validate:graph` | 587 packages audited without vulnerabilities; 683 graph nodes |
| `node scripts/assert-cf-ci-gates.mjs` | Pass |
| `cd pipeline && bun install --frozen-lockfile && bun run audit:deps && bun run test` | 42 packages audited without vulnerabilities; 205 pass, 0 fail |
| `bun run lint:docs` | Pass |
| `cd web && bun run lint` | 0 errors; 14 existing warnings |
| `cd web && bun run typecheck && bun run typecheck:tests && bun run typecheck:scripts` | All three pass |
| `cd web && bun run validate:views -- scripts/fixtures/views` | Pass |
| `cd web && BLOB_BASE_URL=https://blob.example.com SEO_LIVE_BASE='' bun run test:cov` | 2068 pass, 49 intentional offline skips, 0 fail; lines 90.01%, functions 90.62% |
| Loopback GET/HEAD fixture: `cd web && bun run build && bun run validate:host -- --mode production && bun run build:pre && bun run validate:host -- --mode pre` | Both modes: 234 routes / 467 artifacts; exact candidate SHA; fonts, indexing and bindings valid; fixture stopped |
| `git status --short` in detached clone; lockfile checks | Empty; lockfiles unchanged |

`cf:dry-run` was skipped by owner order. No Wrangler/OpenNext command ran.
GitHub Actions readback was `enabled=false`; automation remains disabled.

## Execution progress

The offline gate is complete. Real-source preview build, deployment, import
and post-publication evidence are recorded in subsequent completed steps.
