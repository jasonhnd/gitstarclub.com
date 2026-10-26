# Issue 841: paged repair publication

## Goal

Make the guarded repair publication practical for a 14,000-object recovery while preserving its target guard, printed rollback command, local SHA-256 build verification, lease, recovery seal and verification, create-only stage and verification, pointer commit, and release order.

## Pinned cf findings

The installed `web/node_modules/cf/dist/r2-2QpT_Gso.mjs` from `cf@1.0.0-beta.18` defines `r2 objects list --start-after` and passes its value as the `start_after` query parameter to `GET /accounts/{account}/r2/buckets/{bucket}/objects`. The command prints the API result directly; the list is a JSON array of metadata records with `key`, `size`, `etag`, and other fields, without a pagination envelope. The cf code does not add or remove quotes around `etag`: any surrounding double quotes belong to the API value. For uploaded generation objects, compare a bare MD5 or one pair of surrounding double quotes to the local MD5; source listings need only a nonempty etag because source bodies are read and checked separately. Tech observed full 1,000-row pages and a short final page across 14,027 objects.

## Scope

- Enumerate complete prefixes with 1,000-row pages and the previous page's last key as `--start-after`. Reject malformed records, out-of-prefix keys, nonascending or repeated keys, oversized pages, and a walk that never reaches a short final page.
- Use listing size and MD5 etag to decide resume and verify both complete generations. Keep local builder SHA-256 validation. Read recovery sources once and upload missing recovery copies once.
- Add `--concurrency` with default 4 and maximum 10, plus a progress line every 500 objects with phase, completed, total, elapsed, and estimated remaining time.
- Preserve dry-run with zero real writes and existing 429 and transient-401 retry behavior. Use fake cf tests for call counts, pagination, refusal, resume, and final precommit verification.

## Boundary

On a first publication, the new-generation prefix starts empty, so absent means listed as zero. Existing keys appear only on resume. Then a key is skipped only if both size and MD5 etag match; a different key refuses. This still assumes the required single-writer maintenance window because cf put has no conditional create operation.

## Final check

The old `verifyBootstrapGeneration` reads every object body and does not check that there are no extra keys. It does not satisfy Tech's final check. Immediately before pointer commit, enumerate each recovery and new-generation prefix again to completion and compare the exact key set, size, and MD5 etag to the in-memory expected manifest and manifest bytes. Any mismatch refuses before pointer commit.

## Out of scope

Bucket access, credentials, deployment, branch changes, Cloudflare configuration, and changing the retry policy.

## Acceptance

The fake cf tests prove prefix completeness, call counts, resume, MD5 comparison, and pointer immobility on final-check mismatch. Pipeline tests and the full web coverage suite pass.

## Verification results

- Root and both package installs used frozen lockfiles; no lockfile changed.
- Pipeline tests: 211 passed, zero failed.
- Full web coverage suite on the final implementation: 2,574 passed, 49 skipped, zero failed across 225 files. The coverage gate passed at 90.51% lines and 91.11% functions.
- Fake cf publisher and retry tests: 215 passed, including exact generation call counts, three-page pagination, source read-once behavior, resume, malformed listings, equal-size MD5 drift, extra keys, and unchanged pointer on refusal.
- Web lint, all three typechecks, view validation, dependency audit, and host graph validation passed. Lint reported 14 existing warnings and no errors.
- Local production and pre builds passed with the read-only fixture server. Both matching host artifact validations passed with 234 routes and 467 artifacts.
- `lint:docs` remains blocked by existing unresolved references to two removed performance helper scripts in older plans. Pipeline dependency audit remains blocked by existing high advisories in `undici@6.28.1` and `zod@4.1.11`. Neither is part of this issue.
- No real bucket, credentials, browser, or deployment was used. All work stayed on the existing branch.
