# Issue 855 combined acceptance candidate

## Goal

Prepare one exact product commit for independent acceptance of the dependency and documentation candidates. Refs #855.

## Provenance

- Frozen pre: `179e4682325acdc742ea69d2452d292f8175ac50`.
- Approved dependency candidate, PR #852: `60acb6ab2aad0b19e45908c87180e578cb4b5014`.
- Approved documentation candidate, PR #854: `0440856e561a84a183163cdf951959e1461b8ef5`.
- Each approved candidate has the frozen pre commit as its direct parent.

## Scope

Combine the two approved product diffs and this plan only. Preserve the approved file contents and executable modes. Do not include review carrier files or make additional dependency, source, test, checker, threshold, or lock changes.

## Out of scope

No deployment, integration branch mutation, push, merge, live data or requests, package installation, audit, static checks, Astro builds, or review is part of this preparation.

## Acceptance

The product commit has exactly the union of both approved path sets and this plan relative to frozen pre. Every approved target matches its input blob and mode, all other paths match frozen pre, and the committed tree contains no `REVIEW.md`. Record the exact commit, tree, parent chain, comparisons, and clean diff in external evidence. Independent static and Astro acceptance runs must use that exact commit.
