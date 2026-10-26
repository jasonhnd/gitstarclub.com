# Issue 816: Monthly repository repair notice

## Goal and scope

Add a visible, translated removal notice to monthly repository ranking pages in
both web and Astro, reusing the existing weekly source-note presentation. Keep a
single typed shared configuration with a null publish date and a count of four.
When enabled, include historical months through the publish/removal month;
exclude subsequent months and every other ranking window or entity.

## Out of scope

No ranking computation, data writes, deployment, secrets, repository names in
product copy, screenshots, branch changes, or generated artifacts in commits.

## Acceptance

- All seven dictionaries contain matching notice keys and translated copy.
- Both renderers place the notice below the monthly hero, before ranking content.
- Render tests cover every locale with a date, the unset date, month boundaries,
  and non-monthly/non-repository exclusions.
- Commit the implementation, then run the owner's full install, coverage, Astro
  preview build, Worker tests and Astro tests; repair any failures.
