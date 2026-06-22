# Data correctness analysis for issue #21

Status: phase-1 analysis for #36. This document does not change code, data, or
contracts. It records the current evidence, plausible root causes, and the
tradeoffs for follow-up implementation issues.

Scope is limited to the first three concerns from #21:

1. same repository, conflicting crossing dates across rankings and repo pages;
2. parity gate blind spot after the gross-to-net seam;
3. exact semantics of the `d` factor before and after the seam.

## 1. Same repository, conflicting crossing dates

### Current behavior

The monthly/yearly newcomer rank uses the frozen milestone field:

- `web/lib/workflows/recompute/ranks.ts:158` says newcomers are sourced from
  `crossed_10k`.
- `web/lib/workflows/recompute/ranks.ts:162` iterates `model.repos.values()`.
- `web/lib/workflows/recompute/ranks.ts:163` skips repos without
  `crossed_10k`.
- `web/lib/workflows/recompute/ranks.ts:164` buckets the rank by slicing the
  frozen milestone date.
- `docs/RANKING.md:55` defines newcomer as first crossing 10k.
- `docs/RANKING.md:57` explicitly says the source is
  `repos.crossed_10k`, frozen in `canonical/v2/repos/<bucket>.json`, and not
  recomputed from `stock_est`.
- `docs/DATA-CONTRACTS.md:54` defines `crossed_10k/50k/100k` as first-break
  milestone dates.
- `docs/DATA-CONTRACTS.md:103` says milestones are bootstrap-derived and frozen
  into the repo shard.

The repo page derives its visible milestone chips from the rendered curve
instead:

- `web/app/[owner]/[name]/page.tsx:72` maps
  `repo.curve.monthly[*][2]` into the chart series.
- `web/app/[owner]/[name]/page.tsx:73` derives milestones from that series.
- `web/app/[owner]/[name]/page.tsx:187` renders those derived milestones.
- `web/app/[owner]/[name]/page.tsx:247` starts `starMilestones()`.
- `web/app/[owner]/[name]/page.tsx:252` picks the first curve point whose
  `total` is greater than or equal to the threshold.
- `web/app/[owner]/[name]/page.tsx:257` turns that curve month into
  `${period}-01`.
- `docs/DATA-CONTRACTS.md:259` defines `curve.monthly` as
  `[period, adds, total_end]`.

The underlying curve values come from the seam-aware window computation:

- `web/lib/workflows/recompute/windows.ts:53` documents month/week repo window
  stock anchoring.
- `web/lib/workflows/recompute/windows.ts:75` branches on
  `period <= seamPeriod`.
- `web/lib/workflows/recompute/windows.ts:77` computes pre-seam stock as
  `round(cumGross * d)`.
- `web/lib/workflows/recompute/windows.ts:79` freezes the post-seam anchor.
- `web/lib/workflows/recompute/windows.ts:81` adds post-seam net flow directly.

### Reproduction

Using the public Blob view pointed to by `views/latest.json` on 2026-06-22:

- `lookup/repos.json` resolves `janl/mustache.js` to repo id `326688`.
- `canonical/v2/repos/0.json` has `d = 1.4634103641456582`,
  `crossed_10k = 2022-10-11`, and `current_stars = 16724`.
- `entity/repo/326688.json` has `milestones.crossed_10k = 2022-10-11`.
- The same entity's `curve.monthly` first reaches 10k at `2019-04`, with
  `total_end = 10160`.
- `rank/month/2022-10/repo/new.json` contains repo id `326688` at rank `23`
  with date `2022-10-11`.

So the same repository can show:

- newcomer rank date: `2022-10-11`;
- repo page curve-derived 10k milestone month: `2019-04`.

That is not a contract parse failure. It is a product-level consistency problem:
the site is exposing two different date sources as if both were exact first
crossing dates.

### Root cause hypothesis

The likely root cause is a two-source milestone model:

1. Newcomer ranks use frozen `crossed_10k`, which is the intended source of
   truth for first-break dates.
2. Repo page milestone chips scan `curve.monthly.total_end`, which is an
   anchored historical estimate, not the frozen milestone source.
3. `d` can be greater than 1 in real data. For `janl/mustache.js`, `d = 1.4634`,
   so the historical curve is amplified enough to cross 10k years earlier than
   the frozen milestone date.

This is amplified by documentation language that calls `d` a discount and says
`d <= 1`:

- `docs/RANKING.md:34` defines `d` as a discount `(<= 1)`.
- `docs/VERCEL-DATA-OPERATIONS.md:303` repeats `d <= 1`.
- `web/lib/contracts/canonical.ts:47` only validates `d` as nonnegative, not as
  `<= 1`.

### Fix option

Use frozen milestone fields for exact milestone chips wherever the UI claims a
date. At minimum:

- use `repo.milestones.crossed_10k`, `crossed_50k`, and `crossed_100k` for exact
  10k/50k/100k labels;
- keep curve-derived threshold markers only as estimated curve annotations, or
  label them explicitly as estimated;
- avoid linking curve-derived estimated crossing months to newcomer rank pages
  as if they were exact first-break dates.

Tradeoff:

- Pros: preserves the existing contracts, keeps `crossed_*` as the single exact
  milestone source, and removes the visible contradiction for known thresholds.
- Cons: the current every-50k milestone UI can derive thresholds beyond the
  stored `crossed_50k`/`crossed_100k` fields; exact dates for 150k+ would need
  new data if the product wants them to remain exact.

Impact surface:

- repo page milestone rendering;
- `StarCurve` marker semantics if markers remain visible;
- compare route copy if it uses `crossed_10k` to align curves;
- product/Ranking docs explaining exact milestones versus anchored curve
  estimates;
- tests around repo page milestone source selection.

### No-fix option

Keep both sources unchanged and document the difference: newcomer dates are exact
frozen milestones; repo page curve crossings are anchored estimates.

Tradeoff:

- Pros: no implementation work and no contract/data migration.
- Cons: users will keep seeing contradictory dates for the same repository, and
  the site will appear internally inconsistent even when each individual view is
  mechanically valid.

Impact surface:

- mostly documentation and copy, but the trust issue remains on repo pages.

## 2. Parity gate blind spot after the seam

### Current behavior

The offline parity gate compares the pure-JS recompute output to the legacy
DuckDB-precomputed disk views:

- `web/lib/integration/recompute.test.ts:1` describes it as an offline parity
  gate.
- `web/lib/integration/recompute.test.ts:2` says it recomputes every view from
  local `canonical/v2` shards.
- `web/lib/integration/recompute.test.ts:3` diffs against
  `pipeline/data/views`.
- `web/lib/integration/recompute.test.ts:131` starts `runParity()`.
- `web/lib/integration/recompute.test.ts:134` builds the model using
  `canonMeta.seam_date`.
- `web/lib/integration/recompute.test.ts:135` computes all JS views.
- `web/lib/integration/recompute.test.ts:156` compares each produced view to
  disk.
- `web/lib/integration/recompute.test.ts:224` asserts zero structural
  mismatches.
- `web/lib/integration/recompute.test.ts:228` asserts byte-exact numeric parity.
- `web/lib/integration/recompute.test.ts:230` requires `maxDelta: 0`.

The JS implementation is explicitly seam-aware:

- `web/lib/workflows/recompute/windows.ts:53` says pre-seam periods accumulate
  gross and post-seam periods add net on top of a frozen seam anchor.
- `web/lib/workflows/recompute/windows.ts:75` enters the pre-seam branch.
- `web/lib/workflows/recompute/windows.ts:77` applies `round(cumGross * d)`.
- `web/lib/workflows/recompute/windows.ts:79` freezes the seam anchor.
- `web/lib/workflows/recompute/windows.ts:80` accumulates post-seam net.
- `web/lib/workflows/recompute/windows.ts:81` computes
  `stock_est = anchor + cumNet`.

The authoritative operations doc matches the JS formula:

- `docs/VERCEL-DATA-OPERATIONS.md:298` is the stock anchoring section.
- `docs/VERCEL-DATA-OPERATIONS.md:300` says the discount applies only to
  pre-seam gross and post-seam net is accumulated directly.
- `docs/VERCEL-DATA-OPERATIONS.md:303` defines `d`.
- `docs/VERCEL-DATA-OPERATIONS.md:304` defines pre-seam stock.
- `docs/VERCEL-DATA-OPERATIONS.md:305` defines post-seam stock as
  `stock_est@seam + sum(net flow)`.
- `docs/VERCEL-DATA-OPERATIONS.md:308` says Workflow does not recompute `d`.

The legacy DuckDB precompute path is not seam-split in the same way:

- `pipeline/backfill/05-precompute.mjs:14` describes all backfill as gross.
- `pipeline/backfill/05-precompute.mjs:15` defines
  `stock_est = round(cumgross * d)`.
- `pipeline/backfill/05-precompute.mjs:116` computes a cumulative gross-like
  prefix sum.
- `pipeline/backfill/05-precompute.mjs:120` multiplies the entire cumulative
  value by `d`.

### Blind spot

The parity gate proves that JS output matches the disk reference for the local
snapshot it reads. It does not, by itself, prove that the post-seam formula is
correct once folded base views include post-seam net periods.

If the local disk reference has no folded post-seam period, the post-seam branch
in `windows.ts` is not exercised by parity even though `maxDelta` remains 0. If
the disk reference is regenerated by the legacy DuckDB formula after post-seam
net is present, byte-exact parity may fail for the right reason: JS follows
`anchor + net`, while the legacy SQL follows `round((gross + net) * d)`.

There is a synthetic unit test for the JS formula:

- `web/lib/workflows/recompute/windows.test.ts:58` names the seam-aware stock
  test.
- `web/lib/workflows/recompute/windows.test.ts:62` states that post-seam
  `anchor(120) + net(30) = 150`, not `round(180 * 0.8) = 144`.
- `web/lib/workflows/recompute/windows.test.ts:67` asserts `[80, 120, 150]`.
- `web/lib/workflows/recompute/windows.test.ts:69` asserts that `144` must not
  appear.

But that is not the same as the integration parity gate. The gate remains a
legacy-equivalence test, not an independent post-seam oracle.

### Fix option

Add a follow-up test gate that is independent of the legacy DuckDB disk
reference:

- keep `recompute.test.ts` for pre-seam byte parity against the bootstrap disk
  reference;
- add a synthetic integration fixture with one pre-seam month and one or more
  post-seam months;
- assert the §6.3 formula directly for rank views and entity curves:
  `round(cumGross@seam * d) + sum(post-seam net)`;
- optionally document that DuckDB parity is valid only for bootstrap/pre-seam
  equivalence and is not the oracle for post-seam net periods.

Tradeoff:

- Pros: catches the first post-seam fold semantics before production refresh can
  fail or drift; keeps the JS formula aligned with the current spec.
- Cons: adds test maintenance and separates "legacy parity" from
  "post-seam correctness", so contributors must understand both gates.

Impact surface:

- `web/lib/integration/recompute.test.ts`;
- `web/lib/workflows/recompute/windows.test.ts` or a new integration fixture;
- validation/testing docs;
- possibly workflow validation if a runtime invariant is later added.

### No-fix option

Keep the existing parity gate as the only integration gate.

Tradeoff:

- Pros: no extra fixture or gate complexity.
- Cons: `maxDelta = 0` can be misread as proof of post-seam correctness, and
  the first folded post-seam period can either break the gate or require an
  emergency relaxation without a better oracle.

Impact surface:

- test confidence and release operations; no immediate runtime change, but
  higher risk around the first post-seam fold.

## 3. Exact semantics of `d`

### Source

`d` is currently produced during bootstrap export and persisted in canonical repo
shards:

- `pipeline/backfill/07-export-v2.mjs:80` calls it a frozen discount that
  anchors stock to `current_stars`.
- `pipeline/backfill/07-export-v2.mjs:84` computes
  `current_stars::DOUBLE / g.tot`, falling back to `1` when gross total is zero.
- `pipeline/backfill/07-export-v2.mjs:93` reads the computed `d` rows.
- `pipeline/backfill/07-export-v2.mjs:140` writes full-precision `d` into the
  canonical repo shard.
- `web/lib/workflows/recompute/model.ts:28` describes `d` as frozen at
  `current_stars@seam / cumgross@seam_date`.
- `web/lib/contracts/canonical.ts:47` validates persisted `d` as an optional
  nonnegative number.

The current documentation uses "discount" language:

- `docs/RANKING.md:34` says `d = current_stars / cumgross` and labels it a
  discount `(<= 1)`.
- `docs/RANKING.md:38` says the proportional discount distributes unstars over
  history.
- `docs/DATA-CONTRACTS.md:80` calls `d` a frozen discount coefficient.
- `docs/DATA-CONTRACTS.md:103` defines seam-aware anchoring and says post-seam
  net is not discounted.
- `docs/VERCEL-DATA-OPERATIONS.md:303` says `d <= 1`.

Observed data contradicts the `<= 1` wording. The reproduction above found
`janl/mustache.js` with `d = 1.4634103641456582`. Therefore the precise current
semantics are "anchoring factor", not "discount factor": it can shrink or
amplify pre-seam gross history depending on the ratio between GraphQL
`current_stars` and archive-derived cumulative gross.

### Seam boundary

`seamPeriods()` defines the period boundary used by recompute:

- `web/lib/workflows/recompute/model.ts:71` says `seamDate` fixes the gross/net
  boundary for stock anchoring.
- `web/lib/workflows/recompute/model.ts:121` says the immutable boundary is the
  month/week containing `seam_date - 1`.
- `web/lib/workflows/recompute/model.ts:122` says periods at or before that
  boundary are pre-seam gross multiplied by `d`, and later periods are post-seam
  net.
- `web/lib/workflows/recompute/model.ts:123` implements `seamPeriods()`.
- `web/lib/workflows/recompute/model.ts:124` treats an empty seam date as all
  gross by returning far-future sentinels.
- `web/lib/workflows/recompute/model.ts:126` subtracts one UTC day to find the
  last gross day.
- `web/lib/workflows/recompute/model.ts:127` returns the month and ISO week
  containing that last gross day.

### Pre-seam semantics

For month/week repo windows:

- periods with `period <= model.seam[w]` are pre-seam;
- flow is treated as gross archive flow;
- `cumGross` is incremented by that flow;
- `stock_est = round(cumGross * d)`;
- `d` is allowed by code to be any nonnegative number, so pre-seam `stock_est`
  can be below or above raw cumulative gross.

Code references:

- `web/lib/workflows/recompute/windows.ts:68` reads `d`.
- `web/lib/workflows/recompute/windows.ts:75` tests the pre-seam branch.
- `web/lib/workflows/recompute/windows.ts:76` increments `cumGross`.
- `web/lib/workflows/recompute/windows.ts:77` computes
  `round(cumGross * d)`.

### Post-seam semantics

For month/week repo windows:

- the first post-seam period freezes `anchor = round(cumGross * d)`;
- post-seam flow is net, so it can be negative;
- `cumNet` accumulates raw post-seam net flow;
- `stock_est = anchor + cumNet`;
- `d` is not applied to post-seam net.

Code references:

- `web/lib/workflows/recompute/windows.ts:79` freezes the anchor.
- `web/lib/workflows/recompute/windows.ts:80` accumulates net flow.
- `web/lib/workflows/recompute/windows.ts:81` adds net flow to the frozen
  anchor.
- `docs/VERCEL-DATA-OPERATIONS.md:305` states the same formula.
- `docs/DATA-CONTRACTS.md:103` states that post-seam net is not discounted.

Year windows are derived from monthly rows, not recomputed independently:

- `web/lib/workflows/recompute/windows.ts:94` says year flow is the sum of
  months and year stock is monthly stock at the year's last month.
- `web/lib/workflows/recompute/windows.ts:107` builds per-year accumulators.
- `web/lib/workflows/recompute/windows.ts:114` lets the last month win for
  `cumgross`.
- `web/lib/workflows/recompute/windows.ts:115` lets the last month win for
  `stock_est`.
- `web/lib/workflows/recompute/windows.ts:120` emits the derived year row.

### Fix option

Update terminology and guardrails in a follow-up:

- rename documentation wording from "discount" to "anchoring factor";
- state that `d >= 0` and may be greater than 1;
- keep the persisted field name `d` unless a schema migration is justified;
- add validation or reporting for unusually high `d` values if the product wants
  observability rather than silent amplification;
- clarify that `d` is frozen at bootstrap/seam and not recomputed by Workflow.

Tradeoff:

- Pros: aligns docs with actual data and code, reduces future implementation
  mistakes, and explains why curve-derived historical crossings may move
  earlier when `d > 1`.
- Cons: documentation churn is simple, but adding threshold alerts requires a
  separate product decision about what values are anomalous versus acceptable.

Impact surface:

- `docs/RANKING.md`;
- `docs/DATA-CONTRACTS.md`;
- `docs/VERCEL-DATA-OPERATIONS.md`;
- comments in `model.ts` and canonical contracts;
- optional validation/observability if a threshold is adopted.

### No-fix option

Keep "discount <= 1" wording and current validation.

Tradeoff:

- Pros: no implementation or docs churn.
- Cons: the docs remain false for real data, and future developers may apply
  the wrong mental model by assuming `d` only reduces historical stock.

Impact surface:

- primarily contributor understanding and future correctness work; the current
  runtime behavior does not change.

## Recommended follow-up split

This phase should close #36 only. Suggested follow-up issues:

1. Repo milestone consistency: switch exact milestone UI to frozen `crossed_*`
   fields or label curve-derived crossings as estimates.
2. Post-seam correctness gate: add a synthetic integration oracle for
   `anchor + post-seam net` independent of DuckDB parity.
3. `d` terminology and guardrails: update docs/comments from "discount" to
   "anchoring factor" and decide whether high `d` values should warn or fail.
