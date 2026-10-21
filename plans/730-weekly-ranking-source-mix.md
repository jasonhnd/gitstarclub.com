# Weekly ranking source mix

## Goal

Resolve issue #730 and review P2 of PR #729: a weekly ranking must distinguish
existing observations, aggregate surviving-star history, and their actual mix.

## Scope

- Calculate source metadata from the displayed top 100 rows in object and packed
  ranking paths. Preserve source composition within organization sums and ignore
  idle stock carry when identifying flow sources.
- Keep old artifacts readable and retain the approved provenance object. Add an
  optional mixed-source scope and accurate source notes in all seven locales.
- Cover pure-existing, pure-aggregate, mixed-member, bucket round-trip, idle-carry,
  top-100 and legacy-reader behavior. Update ranking/data-contract documentation.

## Out of scope

No data coverage expansion, new pages, monthly/yearly/stock arithmetic changes,
production or preview mutations, deployments, Wrangler/OpenNext commands, CI or
Worker configuration edits, Actions enablement, protected-branch pushes, force
pushes, shared-branch rebases, merges or final owner acceptance.

## Steps

1. Confirm merged PR #729 base, install frozen dependencies with the verified
   Node 24.20.0 / Bun 1.4.2 toolchain, and record this plan. Commit.
2. Implement source composition and compatible metadata, localized display,
   regression tests and documentation. Run focused checks and commit.
3. Verify the exact final commit from one fresh detached shared clone: complete
   AGENTS bootstrap/static/full-web coverage and fixture production/pre builds
   with host validation. Skip cf:dry-run by owner order. Record every result in
   one PR into pre, then remove temporary copies/output and hand off for review.

## Acceptance

- Existing-only boards have no aggregate source note; aggregate-only boards keep
  the approved note; mixed boards explicitly describe both sources in seven
  locales. Metadata reflects displayed rows, including mixed organization members.
- Legacy artifacts without the new optional scope still parse and render.
- Full exact-head local gates pass with Actions disabled and no remote data calls.
- The PR closes #730 and contains verification and remaining risks.
  Git status is clean and all commits are pushed only to the card feature branch.

Screenshots were reviewed and removed per owner rule.
