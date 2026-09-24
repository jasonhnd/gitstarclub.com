# Issue #521 — resume after metadata GraphQL 502

## Root cause (aligned with the live run)

- #512 already persists `metadata-<bucket>.json` inside the **same run / same bucket hop** and re-enqueues via `retryMetadata`; when `transient_attempts` reaches **6** it throws → `markFailed`, and the whole run is void (`refresh-2026-09-22T12-32-21-068Z` is that path).
- `latest-unpublished-whitelist` reuses only the **Search snapshot**. It does **not** carry GraphQL batch progress from the old run; another Bearer starts over at metadata-0.
- Cold start only relaxes an empty lookup/repos read. It does **not** bypass GraphQL metadata.

## Changes

1. Raise the hop-level transient budget and the backoff cap.
2. When the whitelist is reused from unpublished, write `metadata_resume_run_id`. When metadata is read, merge `fetched` from the old run and reset `transient_attempts`.
3. Docs + tests.
