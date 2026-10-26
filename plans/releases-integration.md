# Releases branch integration

## Goal

Integrate the independent #803 list-page and #804 detail-page changes onto the current trusted-archive branch, in that order, with one commit per branch.

## Scope

Apply each branch's net diff from `5fc52ad19529f020488634753c6f9dca0cc1b788`. Preserve current trusted-archive behavior and combine overlapping release routing, documentation, and tests. Record conflict decisions in each commit body.

## Out of scope

Screenshots and generated artifacts, unrelated changes, branch switching, repository copies, deployment, pushing, and merging.

## Acceptance

Exactly two new commits with the requested subjects; no screenshot or generated files; no conflict markers or whitespace errors; passing Astro tests and complete offline web verification. Verification runs in this repository because the card explicitly prohibits repository copies and branch switching.

## Conflict resolution

- #803 applied cleanly; current footer dates, About data blocks, and writer behavior remain intact.
- #804 had add/add conflicts in the English and localized detail routes. Retained its detailed view for known releases and #803's localized missing-release view with HTTP 404 for unknown releases. Kept locale/id validation and the back-to-list link.
- Removed the duplicate release route matcher introduced by the automatic merge. Kept long localized publication dates and adapted the earlier detail assertion to #804's expanded previous-version wording.
- Omitted the screenshot directory and replaced its dangling link in the imported historical plan with an omission note.
