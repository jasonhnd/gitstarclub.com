---
owner: bootstrap pipeline
status: draft
last_reviewed: 2026-10-19
source_of_truth_for:
  - GSC_0080 UTC star-history collection and access evidence
  - fixed-whitelist pilot cost estimates and resume commands
---

# UTC surviving-star gap collection

Issue #680 / card GSC_0080, owner decision d1019-001344-1 = A.
Read-only collection only; nothing here authorizes upload or publication.

The approved window is `[2026-05-30T00:00:00Z, 2026-10-01T00:00:00Z)`.
The fixed 5,249 ids come from the R2 archive at
`gitstarclub-raw/bigquery-export/whitelist/data-000000000000.parquet`.
No discovery or whitelist expansion is allowed. The implementation verifies
exact id-set equality against GSC_0045's retained whitelist before preparing
its manifest. Metadata names are advisory; GitHub stable repository ids are
the identity check, so renames do not change whitelist membership.

## Metric and access contract

The tool requests `stargazers(first:100, after:..., orderBy:{field:STARRED_AT,
direction:DESC})` through `gh api graphql`, the existing GitHub CLI login.
It does not retrieve, print or persist tokens or request user identities.
Initial pages are batched for at most 20 repositories (at most 2,000 edges)
per serial request; subsequent pages use one repository's own cursor. This
reduces first-page overhead without conflating repository checkpoints.
Each timestamp is normalized to UTC. Collection stops after encountering
`starredAt` before May 30 or validating complete connection exhaustion.
Newer October stars are traversed but not counted in the approved window.

These are query-time **surviving stars**, a lower bound on gross additions.
Removed stars and removal dates are invisible; this cannot reconstruct
historical net changes. The GitHub [history announcement clarification](https://github.com/orgs/community/discussions/206104)
confirms this limitation for its aggregate history source as well. Later
reads may revise past counts. A multi-page extraction is not a transactional
snapshot: a stock change during paging is rejected, but equal-count star
turnover is not detectable. Per-page evidence and request dates are retained.

The [GraphQL schema](https://docs.github.com/en/graphql/reference/repos)
exposes star counts separately from the stargazer connection. The tool refuses
to treat an empty connection with positive stock as zero additions. Private,
missing/inaccessible, forbidden, invalid, count-mismatched and changing
sources have separate statuses and null daily counts. A missing repository
cannot be diagnosed as deleted versus inaccessible from this response alone.
There is no automatic fallback to GH Archive or aggregate history, whose
UTC day boundaries remain unguaranteed in [PR #669's assessment](PREVIEW-GAP-REHEARSAL.md).

## Recovery and rate limits

Per-repository JSON is the authoritative checkpoint: cursor and counts advance
in one atomic rename after each page, and every repository has its own final
status. Raw identity-free page evidence is written before that checkpoint;
a crash between the two replays the uncommitted page without double-counting.
A process lock prevents concurrent collectors in the same output directory.
Completed repositories are skipped; unavailable ones require an explicit
`--retry-unavailable`. This starts that repository again from its newest page.
Never run two collectors or manually edit a checkpoint.

The serial client spaces request starts by at least one second, records actual
`rateLimit.cost`, and pauses before spending the final ten points. Both quota
resets and `Retry-After` persist across restarts. Secondary-limit retries wait
at least a minute and increase exponentially, with six total attempts.
Long waits are polled in at most one-minute slices; a chunk whose deadline
would be exceeded exits with its cooldown and progress retained. These rules
follow the [GitHub GraphQL rate-limit documentation](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api).
Hourly quota is shared with other uses of the existing login.

All collection outputs, including source fingerprints, per-page evidence,
checkpoints, summaries and estimates, live only under
`/Users/ms23m2/AgenticCoder/gitstarclub.com/.kanban-work/leader/star-history/`.
They survive card cleanup and are excluded from Git. Temporary toolchain,
logs and isolated verification output use this card's own `.kanban-work/GSC_0080/`.
