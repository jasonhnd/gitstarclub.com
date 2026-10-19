# Local read-only pipeline tools

## UTC star history collection

`star-history.mjs` (issue #680, GSC_0080) reads the unchanged R2 whitelist
and collects surviving-star timestamps through the existing `gh api graphql`
login only. It never reads or prints credentials, requests stargazer identities,
or writes remote objects. Its CLI locks output to the expressly authorized
excluded `leader/star-history` directory; no data belongs in Git.

```bash
node pipeline/scripts/star-history.mjs --help
```

`prepare` validates all 5,249 R2 ids against the retained GSC_0045 whitelist,
fingerprints inputs and selects the original 40 samples plus ten deterministic
members. `inventory` checkpoints current stocks in batches of 100 stable ids.
`fetch --pilot` collects those 50; `fetch` resumes the full whitelist.
`--max-repos` and `--max-seconds` bound foreground chunks. `report` summarizes
coverage, the 342,659 reference comparison, and conditional cost estimates.
Unavailable histories stay null and need `--retry-unavailable` for another
attempt; missing/private members never imply zero additions. Exit 2 means
coverage is incomplete or the chunk paused, 1 means a fatal error, and 0 on
`fetch` means every selected repository has validated history.

Counts include UTC May 30 through September 30, 2026 only. Removed stars are
unobservable, so these are lower bounds on gross adds and are not net changes.
Primary quota and secondary backoff persist across restarts. No automatic
fallback to nominal-day aggregate history, GH Archive, or published snapshots
is permitted. See the [collection report](../../docs/analysis/STAR-HISTORY-GAP.md)
for exact commands, access limitations and measured coverage.

## Preview-gap rehearsal

These are offline/bootstrap tools for issue #668. They cannot publish data.
The only network operations are authenticated BigQuery metadata/tabledata
GETs and public snapshot GETs. The original query is not rerun. Nothing calls
GitHub Search, stargazer history for the full whitelist, cron, R2, or Blob.
Outputs must be inside an explicitly supplied `KANBAN_TMP` child directory.

Run the pinned toolchain bootstrap and dependency installation from AGENTS.md
first. From the repository root, use the numbered, exact commands in
[the rehearsal report](../../docs/analysis/PREVIEW-GAP-REHEARSAL.md).

```bash
node pipeline/scripts/preview-gap-rehearsal.mjs --help
```

- `backup` verifies all 20 manifest sizes/SHA-256 values before copying the
  May files, and retains the exact 5,249-member whitelist.
- `export` reads the existing dated gap table through every `tabledata.list`
  page, rejects truncation/duplicates/out-of-scope rows/source changes, and
  writes typed local Parquet. It obtains the active gcloud token in memory;
  it never prints or persists the token. Fresh output paths are required.
- `metadata` assembles the fixed ids from 32 public canonical snapshots and
  frozen entity fallbacks. Source URLs, bytes and hashes go into a provenance
  manifest. `--cached-snapshots DIR` can replay the original retained inputs;
  any missing cached file is fetched by public GET. It preserves historical
  inactive status and does not weaken strict step 03.
- `summary` checks the union keys/date boundaries/id set and recreates the
  June–September site/repository comparison. An explicit frozen 404 is
  unavailable, never zero.

The committed fold probe uses the real fold implementation with injected
local I/O only:

```bash
bun --no-env-file web/scripts/probe-preview-gap-fold.ts "$REPLAY/pipeline-data/v2/canonical/v2" "$REPLAY/fold-proof.json"
```

Positive and negative controls have separate evidence objects; the JSON
records positive empty `pendingReads` after all negative controls finish.
Both tools are covered by the normal pipeline and full web suites. The
snapshots are dated inputs, not fresh metadata. Public canonical snapshots
are mutable, so a later fresh download can differ from the original run;
the provenance hashes identify the exact inputs used. Generated timestamps
also vary in step 05. No data files belong in Git, and no rehearsal output
is eligible for upload.
