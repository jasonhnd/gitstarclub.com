# GSC_0170: Open the aggregate import documentation PR

## Goal

Publish the committed GSC_0161 preview aggregate import documentation and evidence as one pull request into `pre`.

## Scope

- Use a detached checkout of the current GSC_0161 branch head.
- Remove the six acceptance screenshots and references to them.
- Update the execution report and evidence JSON using the GSC_0161 and GSC_0169 handoffs.
- Run the requested documentation lint and whitespace check, push the same branch, and open one PR into `pre`.

## Out of scope

- Application code, deployments, data writes, merges, or changes beyond the two report files and screenshot cleanup.

## Acceptance

- Exactly one commit on the source branch contains the scoped report/evidence edits and screenshot removals.
- Verification commands and outcomes appear in the PR body, which includes `Closes #N`.
- The PR targets `pre` and remains unmerged.
