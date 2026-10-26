# Issue 816: Ranking notice rework

## Goal

Make the monthly repository removal notice visible beside the ranked content.

## Scope

- Place the shared info strip after the Answer capsule and directly before the
  first ranked cards in both renderers and all seven locales.
- Reuse existing muted surface, text, and border tokens with 16 px pretty-wrapped
  text, and update all seven translations.
- Reject missing, malformed, and impossible ISO publish dates and update tests.
- Run the requested full verification, then temporarily enable the notice for
  local preview screenshots and restore the disabled constant.

## Out of scope

Deployment, remote data writes, secrets, branch changes, and committed screenshots.

## Acceptance

- Notice order is Answer capsule, info strip, first ranked cards on every viewport.
- Exact requested meaning is present in every locale, including repository nouns
  in both Chinese dictionaries.
- Null or invalid dates render nothing; historical month boundaries still work.
- Full web coverage, Astro preview build, Worker tests, and Astro tests pass.
- Five requested PNGs and their local URLs are saved outside tracked files.

## Workspace

Remain on the supplied current branch `ib/gsc-816-r2`; do not switch branches.
