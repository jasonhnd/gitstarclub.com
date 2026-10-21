# Issue #686: aggregate request pacing and final-run evidence

## Goal

Resolve the two nonblocking P2 findings from GSC_0094 on merged PR #685.
Base: `origin/pre` at `619929343fbc51bc9852840187ddd41110d55d97`.

## Scope and steps

1. Confirm the merged base, archive-verify Node 24.20.0 and Bun 1.4.2, and install
   web and pipeline dependencies with frozen lockfiles.
2. Read retained summary and input manifest without modifying them. Commit the
   final October 19 counts, six unavailable names and manifest SHA-256 to the
   aggregate analysis document.
3. Record actual request starts after state persistence, preserve conservative
   pacing after interrupted requests, and add fake-clock regressions for a slow
   save followed by fast saves and reconstruction between requests.
4. Run the exact-head verification gate, publish the current branch and open one
   pull request into `pre`, including `Closes #686` and every verification result.
   Submit the card for independent review without merging.

## Out of scope and forbidden operations

No live history fetch, data coverage expansion, retained leader-data writes,
production or preview refresh calls, Cloudflare changes, Wrangler/OpenNext
commands, CI or deployment configuration edits, force-push, merge, branch
removal, or push to `main`, `pre` or `preview`.

## Acceptance

- The document records 5,249 repositories, 5,243 complete and six unavailable;
  650,132 of 650,876 repository-days (744 missing); 89,131 complete ISO week rows;
  10,486 partial week rows; and the verified input manifest fingerprint.
- Consecutive actual transport starts remain at least 1,050 ms apart even when
  state saves take different amounts of time; restart pacing remains safe.
- Full pipeline tests and `bun run lint:docs` pass.
- One fresh detached checkout of the exact submitted head passes the AGENTS.md
  bootstrap, full static gate, full web coverage suite and fixture production
  `bun run build` under a clean environment. Skip `cf:dry-run` by owner order.
- Actions stays off; record results in the PR and handoff. Remove the single
  verification copy promptly, clean temporary artifacts and leave Git clean.
