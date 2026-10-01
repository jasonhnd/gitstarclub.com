# Issue 610: repository and organization snippet deduplication

## Goal

Use one serializer for shareable content, retain the live localized semantic copy,
and remove repository sections with no production callers.

## Scope

- `web/app/_localized/repo.tsx`, `org.tsx`, and `repo-sections.tsx`.
- `web/lib/shareable-snippets.ts` and its tests.
- Repository/organization hub contract tests and repository milestone tests.
- New `web/lib/template-format.ts` for typed placeholder, signed-star, and list formatting.
- This required plan and task-specific desktop/mobile before/after image evidence.

## Out of scope

Other pages, locale dictionaries, capsule/FAQ libraries, ranking period semantics,
CSP, language switching, Star, CI/deployment configuration, credentials, live data,
and production operations. No merge or push to protected branches.

## Steps

1. Bootstrap the pinned toolchain, install frozen dependencies, and record baseline
   localized snippet fixtures and desktop/mobile populated/empty page screenshots.
2. Share serialization and formatting; retire test-only English repo/org snippet
   builders and the four unused repository sections with their private helpers.
3. Exercise the live localized builders in all seven locales and retain history,
   milestone, hub-link, missing-metadata, and empty-state contracts.
4. Verify the committed head in a fresh detached tree under this task directory:
   full static job, fixture production build, and preview-only CF dry run.
5. Compare screenshots and publish one feature PR to `pre` for independent
   Claude-family review and owner visual sign-off. Do not merge.

## Acceptance

Copied text, escaped embed HTML, and canonical URLs match baseline fixtures in
seven locales. History and milestone sections remain live, including missing
metadata/milestones. Placeholder fallback and zero/negative values are preserved.
All static checks and fixture builds pass, and no lockfile churn is committed.
Behavior changes, if any, need a rollback failure demonstration; output-preserving
refactoring uses fixed baseline fixtures and integration contracts instead.
