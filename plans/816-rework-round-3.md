# Issue 816: Info strip rework round 3

## Goal and scope

Use the existing contrasting outline token and card radius for the repair notice.
Reuse the localized date formatter with a long month, retain strict ISO source
validation, and bind each count to its counter with a no-break space. Update
shared rendering and page tests, verify built colors in both themes, and run the
requested full coverage, preview build, Worker tests, and Astro tests.

## Out of scope

No branch changes, deployment, secrets, remote data writes, new tokens, or
committed screenshots. Keep the publish date null in the committed source.

## Acceptance

- Border and fill differ in both built themes; regression tests detect equality.
- Strip radius matches the neighbouring Answer capsule and ranking cards.
- All seven locales use the existing date formatter and unbreakable counts.
- Full requested verification passes. Capture the two requested local screenshots
  with the temporary October 27 date last, then restore the source with git checkout.

## Verification

On implementation commit `b4cea2c`, the final web coverage run passed 2,224 tests
with 49 intentional skips and zero failures; coverage was 90.20% lines and
90.75% functions. The preview build, 13 built Worker tests (including computed
border/fill colors and matching capsule radius), and all 413 Astro tests passed.
Web lint (14 existing warnings), all three web typechecks, Astro typecheck, web
dependency audit, all 15 view fixtures, and all 205 pipeline tests passed.

Additional static checks remain blocked by existing issues outside this change:
`lint:docs` reports eight unresolved script references across four unchanged
plans. The pipeline dependency audit reports two high-severity advisories in
transitive dependencies of `@vercel/blob` (`undici` and `zod`). No dependency or
unrelated documentation edits were made.

The owner-required final evidence step uses only a fresh Chromium profile and a
local built Worker with synthetic fixtures. The temporary publish date is
restored with `git checkout -- web/lib/repair-removal-notice.ts` after capture;
no screenshots are staged or committed.
