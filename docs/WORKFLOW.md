---
owner: issue and PR workflow
status: active
last_reviewed: 2026-07-06
source_of_truth_for:
  - document-driven issue workflow
  - role boundaries
  - merge gates
  - visual guardrails
---

# Document-Driven Development Workflow (文档驱动开发工作流)

## Scope

This document is the source of truth for how GitStarClub work moves from issue
to pull request to merge. It defines the required issue shape, role boundaries,
merge review gates, and visual-change guardrails.

Implementation playbooks remain in [DEVELOPMENT.md](./DEVELOPMENT.md). The
locked visual baseline lives in [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md).

## Issue Rules

Every work unit starts as a GitHub issue, including documentation-only work.
Issues are split into two types:

| Issue type | Purpose | Expected output |
|---|---|---|
| Documentation issue (文档 issue) | Establish or revise the source-of-truth document before implementation. | A docs-only PR, or a docs section that can be reviewed independently. |
| Development issue (开发 issue) | Implement behavior that is already specified by an accepted document. | Code, tests, and any owning-doc updates required by the accepted spec. |

Substantive functionality changes are document-first: open and merge the
documentation issue before opening the development issue. This includes new
routes, data contracts, ranking behavior, workflow behavior, cron behavior,
runtime constraints, user-visible copy contracts, and operations procedures.

Any visual change is also document-first. Changes to palette, typography,
spacing, radius, elevation, page chrome, component appearance, or motion require
an accepted design document before code changes are eligible for merge.

Pure consistency fixes may combine docs and code in one PR only when the code
already represents the intended state and the docs are being corrected to match
that state. The PR must say that it is a consistency fix and identify the owning
document.

## Role Boundaries

The maintainer who files the issue and reviews the PR does not directly
implement that issue. The maintainer owns intent, scope, acceptance criteria,
and final approval.

Codex owns implementation. Codex claims the issue, creates the branch, edits the
repo, runs validation, opens the PR, and responds to review. Codex must keep the
PR inside the issue scope and must not bundle unrelated cleanup or opportunistic
refactors.

When an issue is ambiguous, Codex should ask for a scope decision or choose the
smallest implementation that satisfies the written acceptance criteria. The PR
must state any deliberate exclusions.

## Merge Flow

Every PR is reviewed in two separate passes.

Branch topology and promotion are owned by [OPS.md](./OPS.md) §Branch topology /
staging. Feature PRs target `pre`, staging verification uses
`https://pre.gitstarclub.com`, and production promotion is a merge from `pre` to
`main`.

### 1. Should This Merge? (是否该合并)

This pass decides whether the change belongs in the project.

Reviewers check:

- The PR matches the issue acceptance criteria.
- The PR cites the owning document and updates it when behavior, contracts,
  routes, operations, copy, or visual rules changed.
- The hard constraints still hold: zero runtime engine/database, near-zero client JS
  on content pages with explicit global islands, AI-free deterministic behavior, and Vercel-first operations.
- Validation is green for the required commands.
- The PR avoids unrelated code, docs, formatting, generated files, and broad
  rewrites.
- Partially completed issues are described as partial work and do not use a
  closing keyword.

### 2. Should This Run? (是否该运行起来)

This pass decides whether the merged change should be deployed, triggered, or
verified in production.

Reviewers check:

- The Vercel preview or build signal is sufficient for the change type.
- Data or workflow changes have a clear recompute, cron, rollback, or publish
  plan.
- Production verification identifies the exact page, Blob view, workflow run,
  or artifact that proves the change.
- Operational timing is acceptable, especially around current-period live
  overlays, publish pointers, and cron-maintained artifacts.

A PR can be mergeable as code but still require an explicit decision before a
workflow refresh, cron trigger, or production verification run.

## Visual Guardrails

The locked baseline is [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md). It records the
visual tokens and Chrome appearance from commit `689605c`.

Any PR that changes `web/app/globals.css`, Tailwind theme mappings, design
tokens, color values, typography, spacing, radius, elevation, motion, page
chrome, or user-visible appearance must satisfy all of these before merge:

- It has an approved design issue or design document before implementation.
- It updates [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) in the same PR if the
  approved baseline changes.
- It lists the affected tokens, routes, and components in the PR body.
- It shows before/after visual evidence for the affected surfaces, including
  desktop and mobile when responsive behavior is touched.
- It includes light and dark theme evidence when theme tokens or contrast are
  touched.

Without the approved design document and before/after visual evidence, the PR
does not merge even if lint, tests, and build pass.

Non-visual accessibility fixes are not visual redesigns. Focus visibility,
skip-link reachability, keyboard navigation, ARIA labeling, and semantic markup
may be implemented when they preserve the visual baseline or when any visible
change is explicitly documented and approved.

## PR Checklist

Before opening a PR:

- Confirm the issue type: documentation issue or development issue.
- Confirm the owning document from [docs/README.md](./README.md).
- Keep the branch scoped to the issue.
- Run the requested validation commands.
- For Markdown changes, run `bun run lint:md`.
- Write a PR body that states summary, issue linkage, scope boundaries,
  validation results, and reviewer notes.
- Use `Closes #N` only for issues fully completed by the PR.
