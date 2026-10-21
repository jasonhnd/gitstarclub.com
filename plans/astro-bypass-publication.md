# Astro bypass publication fence

Issue: #703. Card: GSC_0125. Base and PR target: `feat/astro-site`, after
PR #698 merged as `f5c62edd17f4f260e1ea7865d008f50a56215068`.

## Goal

Prevent a cookie/auth page request from serving output from a publication that
changed during rendering. Apply the existing publication identity check and
retry-once-then-503 rule to cache-bypassing GET/HEAD output.

## Scope

- Reuse the shared host's buffered render and publication checks for read-only
  bypass requests without reading or writing the shared page cache.
- Keep mutating requests single-execution, including P7 operational handlers.
- Cover publication changes during body consumption, successful retries,
  repeated-race failure, and cache isolation with deterministic host tests.
- Clarify the shared publication contract in the migration documentation.

## Out of scope

P1-P7 package directories, page entry files, dictionaries, lockfiles, `web/`,
data coverage, CI/workflow/delivery files and Worker configuration stay outside
this change. No Wrangler, deployment, remote data mutation, live refresh/cron,
merge, force push or push to `pre`, `main` or `preview` is authorized.
GitHub Actions remains disabled. Independent review owns final acceptance.

## Steps

1. Confirm the merged base, checksum-verify Node v24.20.0/Bun 1.4.2, install
   frozen dependencies, and commit this plan.
2. Add regression tests, demonstrate their failure on the original host, fix
   the bypass path, update the publication documentation, and commit.
3. Verify the exact head in one fresh detached shared clone under the card
   directory, record results in the PR, and remove temporary artifacts.
4. Push only the current card branch, open one PR to `feat/astro-site` with
   `Closes #703`, and hand off to independent review without merging.

## Acceptance

- Cookie/auth GET and HEAD renders consume output before checking publication;
  one change retries with newly captured data, a second returns 503.
- Bypassed requests never access shared page storage. Mutating requests are
  never replayed after publication changes.
- `cd astro && bun run verify:local` passes on the exact PR head.
- The full AGENTS.md bootstrap/static block, full web suite with coverage, and
  fixture production/pre builds with matching artifact validation pass on that
  same head. Keep the shared toolchain cache and shared Bun install cache per
  owner disk-hygiene instructions. No owner environment files are copied.
- Record every command and result, exact SHA, and owner-ordered `cf:dry-run`
  skip in the PR body. Finish with clean Git status and small card scratch space.
