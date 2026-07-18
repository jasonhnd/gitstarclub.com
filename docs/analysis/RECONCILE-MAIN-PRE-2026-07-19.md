# Inventory: main ↔ pre reconciliation (2026-07-19)

## SHAs (after fetch)

| Ref | SHA |
|-----|-----|
| `origin/main` | `e677a538bb243166d15afbeb53c56d77ca57ce6e` |
| `origin/pre` | `a20887d23c4f45decf95e565a168eb0d9fa7f11c` |
| merge-base | `c8dba52da1af34f53dbb22eb37dacd1cfe3ec11b` |
| main-only commits | **7** |
| pre-only commits | **25** |

## Deployments (`.well-known/deployment`)

| Host | commitSha |
|------|-----------|
| production `gitstarclub.com` | `e677a53…` (main tip) |
| preview `pre.gitstarclub.com` | `a20887d…` (pre tip) |

## Branch policy freeze

- No direct merges to `main`.
- No force-push / history rewrite.
- #286 remains **OPEN**.
- No `pre → main` promotion without owner approval.

## Main-only (emergency recovery line)

1. `9454e80` / `5723f6a` / `bcd854b` — #311 product-gates (reopens #286)
2. `07c9695` — #312 startRun lease deadlock
3. `b5cbe6e` — #313 exports + revalidate + forceWrite lease
4. `860b8e3` — #314 pointer cache bust
5. `e677a53` — #315 W27 GH Archive backfill

## Pre-only (audited integration line)

PR #310 integration of #289–#309: fencing, atomic publication, health, contracts, a11y/i18n, search, CI, bootstrap recovery, etc. (25 commits).

## Overlapping / conflict files (merge main → pre)

Content conflicts:

- `web/lib/contracts/canonical.ts`
- `web/lib/contracts/contracts.test.ts`
- `web/lib/data/source.ts`
- `web/lib/workflows/checkpoint.ts`
- `web/lib/workflows/lease.ts`
- `web/lib/workflows/lease.test.ts`
- `web/lib/workflows/refresh.ts`
- `web/lib/workflows/steps/publish.ts`

Also touch both sides (auto-merge candidates): `.github/workflows/ci.yml`, `docs/OPS.md`, `.delivery.yml` (differs: main lists `product-gates`, pre does not).

## Governance gap

| Source | Required checks |
|--------|-----------------|
| main `.delivery.yml` | static, production-build, preview-e2e, **product-gates** |
| pre `.delivery.yml` | static, production-build, preview-e2e |
| GitHub ruleset `release gates (pre/main)` | static, production-build, preview-e2e (**no product-gates**); `strict_required_status_checks_policy: false` |

## Unresolved review findings (engineering work)

### #310 (pre) — P1
- Validate rollback view before pointer switch (`publication-core.ts`)

### #311 — P1/P2
- Exports age (addressed by #313 data; keep gates fail-closed)
- Publication-schedule grace (Mon 00–03 UTC / 1st of month)
- ISO W53 year rollover

### #312 — P2
- Revalidate lease before delayed step execution
- Do not send write token to public CDN URL
- TOCTOU head/fetch on lease read

### #313 — P1/P2
- Locale + nested revalidate paths
- forceWrite TOCTOU / late release CAS
- revalidatePath scope for `/o` children

### #314 — P1/P2
- `revalidateTag(..., "max")` is stale-while-revalidate; need expire:0

### #315 — P2
- W27 must survive fold watermark advance
- Backfill timeouts / cancel body / reject --date+--finalize

## Phase order (this work)

1. Reconcile branch from pre ← main (semantic conflicts)
2. Fix Phase 3 A–D
3. PR into **pre only**
4. Ruleset update only after product-gates green once
5. No production promotion
