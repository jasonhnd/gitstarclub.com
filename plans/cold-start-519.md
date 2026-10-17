# Issue #519 — preview cold-start contract

- **task_id**: `gitstarclub-cold-start-519-cca`
- **baseline**: `pre`
- **Issue**: https://github.com/jasonhnd/gitstarclub.com/issues/519

## Goal

When the preview Blob has no `canonical/v2/meta.json`, no `lookup/repos.json`, and no 65015, a Bearer full refresh can still write a new universe from Search.

## Implementation notes

- `WORKFLOW_COLD_START=1` (wrangler `env.pre` only) plus the existing `PREFLIGHT_RELAX_EMPTY_SHARDS=1`
- Trigger: `views/latest.json` is still 404 (before the first publish)
- Route: enqueue is allowed; workflow preflight writes a minimal valid `canonical/v2/meta.json` under the lease
- Whitelist baseline `[]`; a missing lookup / repos / series shard is read as `{}`
- `seam_date` = the bootstrap UTC day; `node_id` / stars come only from GitHub

## Conflict priority (documented)

Cold start > #515 empty-bucket placeholder semantics extension > #512 502 recovery path (502 still applies, but it no longer requires the old lookup) > SafeText (still truncates; it does not invent data)

## Out of scope

- Do not trigger a Bearer refresh, do not empty Blob, do not merge to main
