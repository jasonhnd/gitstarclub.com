# Issue #787: offline production repair comparison

## Goal

Recompute the option B builder output locally and compare it against the retained frozen generation without network access or remote writes.

## Scope

- Read the builder's sealed local base and canonical phases and use the existing pure in-memory recompute implementation.
- Compare every monthly repository rank file, monthly organization curve, and month heatmap; retain every difference in a machine-readable report and exit nonzero on monthly mismatches.
- Report W23 through W39 week rank files and their surviving-star provenance, including absent files and mixed measurements.
- Add small-fixture regressions and document exact offline Mac commands using the part 1 output.

## Out of scope

Input downloads, private data, credentials, bucket access or writes, production rehearsal or publication, deployment tools, changes to recompute formulas, new pages, and branch switching or merging.

## Acceptance

- Matching fixtures pass; changed values, missing or extra files and curve points, and dropped-membership effects are fully reported and fail the monthly gate.
- Weekly differences remain informational and cannot hide monthly failures. Aggregate flow and unknown-stock behavior come from real recompute.
- The full web coverage suite, pipeline tests, static checks, and both local build modes pass using the pinned toolchain and local fixtures.
- No real repair dataset is downloaded or compared on this card.

## Execution constraints

Stay on `ib/gsc-787` in `~/w`. The owner's workspace and branch rules override the generic detached-clone verification procedure: run the same clean-environment checks in place, with all temporary files and caches under `.kanban-work/787/`. Do not launch a browser; this change has no UI.
