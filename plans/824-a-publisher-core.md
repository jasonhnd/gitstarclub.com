# Issue 824-A: repair publisher core

## Goal

Add a small publisher for the local issue 786 builder output, with all remote
commands passing through one injectable cf runner.

## Scope

- Reuse bootstrap manifest validation and verify every object before remote work.
- Check exact key existence, compare existing bytes, skip identical keys, refuse
  different keys, and upload absent keys with bounded parallelism.
- Seal each phase only after its objects finish; include manifests in dry-run output.
- Test exclusively with a fake cf runner, including refusal and concurrency cases.
- Update the repair builder documentation and run pipeline and full web tests.

## Out of scope

Recovery generation, pointer commit, writer lease, target guards, real bucket
access, credentials, deployment, and repository branch changes. cf has no atomic
conditional put; the later lease card must supply writer exclusion.

## Acceptance

Both manifests and all object sizes and SHA-256 fingerprints validate before any
cf call. Existing different bytes refuse; matching bytes resume without a put.
Dry-run emits key, size, and SHA-256 and never puts. Concurrency stays at or below
the configured positive integer bound. Tests record only fake cf calls.

## Verification

Use a clean environment with card-local temporary files in this checkout. The
owner prohibits copying the repository or changing branch, so run checks here
rather than creating the detached clone described in the general instructions.

## Results

Implementation commit: `a04ccdd` (`feat: add repair generation publisher core`).
Verification ran in this checkout with a clean environment and card-local
`TMPDIR`/`KANBAN_TMP`, using Node v24.21.0 and Bun 1.4.2. No cf process was
invoked, and no remote storage was accessed.

- Frozen-lockfile installs completed at root, pipeline, and web; no lock changes.
- `cd pipeline && bun test --timeout 30000`: 206 passed, zero failed.
- `cd web && BLOB_BASE_URL=https://blob.example.com SEO_LIVE_BASE= bun run test:cov`:
  2,221 passed, 49 skipped, zero failed across 215 files. Coverage gate passed
  with 90.18% line coverage and 90.77% function coverage.
- Publisher tests: 27 passed, covering the required behaviors plus interrupted
  upload/resume, manifest ordering, malformed pagination, local mutation, and
  command-line refusal exit status.
- Web lint: passed with 14 existing warnings; all three typechecks passed.
- View fixture validation and host dependency graph validation passed.
- `build:production`, `build:pre`, and matching `validate:host` commands passed
  against the local read-only fixture: 234 routes and 467 artifacts in each mode.
- Documentation unit tests: 44 passed. Documentation contract check passed.
- `lint:docs` is blocked by existing missing metadata frontmatter in
  `docs/analysis/743-preview-empty-monthly.md`; that file was not changed.
- Web dependency audit passed. Pipeline dependency audit is blocked by existing
  high-severity advisories for `undici@6.28.1` (GHSA-xjj6-f33q-929c) and
  `zod@4.1.11` (GHSA-mrhx-c7xc-m3w5). Dependencies were not changed.

Outstanding scope remains exactly the later issue 824 cards: recovery
generation, pointer commit, writer lease, target guards, and rehearsal.
