# Aggregate star-history gap inputs

Issue #682; card GSC_0090; owner decision d1019-214826-1 = A.

## Goal

Prepare local-only, explicitly labeled surviving-star daily and ISO-week inputs
for the fixed 5,249 repositories over 2026-05-30 through 2026-09-30.
Preserve every already-published monthly net value.

## Scope and steps

1. Install dependencies using the archive-verified Node 24.20.0 and Bun 1.4.2
   bootstrap. Pin the retained whitelist to its verified R2-equivalent digest.
2. Implement a sibling aggregate collector using only serial `gh api` GETs,
   >=1.05-second request-start spacing, persisted rate-limit cooldowns, raw
   evidence, atomic repository checkpoints, and bounded resumable chunks.
3. Test pagination, date labels, unavailable sources, rate limiting, crash/resume,
   whitelist enforcement, ISO-week conversion, provenance and monthly isolation.
4. Fetch every fixed member locally, retaining all raw and daily output only in
   the approved excluded `leader/star-history-agg/` directory.
5. Export canonical-compatible daily and complete ISO-week shards plus partial
   edge-week contributions and a SHA-256/coverage/provenance manifest.
6. Document semantics and exact resume commands; run the complete AGENTS static
   job and fixture production build in a clean detached checkout of the final
   commit. Submit one PR to `pre` with `Closes #682` for independent review.

## Out of scope and prohibited operations

No monthly reconstruction, stock anchoring, whitelist expansion, preview publish
integration, page labels, storage writes, cron/refresh calls, deployment,
Wrangler/OpenNext execution, workflow/config changes, merges, force-pushes, or
pushes to `pre`, `main` or `preview`. Fetched data is never committed.
GitHub Actions stays off; `cf:dry-run` is skipped by explicit owner order.
Temporary caches, logs, clones and build output stay in this card's excluded
`.kanban-work/GSC_0090/` directory. A detached local clone provides the clean
verification checkout without creating another worktree.

## Acceptance

- Exactly 5,249 pinned whitelist members have terminal checkpoints, with missing
  or inaccessible sources explicit and never interpreted as measured zero.
- Raw responses and per-repository daily values survive card cleanup in the
  authorized leader directory. Every completed repository has verifiable hashes.
- Only the approved 124 daily labels are exported. Complete ISO Monday-Sunday
  weeks are recomputed from these daily rows; partial boundary weeks are kept
  separate for a later integration that can supply adjacent existing data.
- The manifest identifies surviving-star semantics, approximate day boundaries,
  request/coverage counts, missing repositories, file fingerprints and provenance
  flags. No monthly shard or frozen stock is generated or modified.
- The full pipeline and web suites, docs lint, all typechecks, view validation,
  dependency audits and fixture production build pass on the exact PR head.
  The PR records results and the mandated Cloudflare dry-run omission.
