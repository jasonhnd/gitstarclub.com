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

## Implementation contract

`buildShareableSnippet` is the only content serializer for weekly, repository,
and organization snippets. It receives semantic title/text, ordered links, and
the source label. It canonicalizes copied links and escapes embed text and
attributes while retaining literal copied text. The first link remains the cited
source; an empty link list cites the canonical site root.

The localized repo/org builders remain on their pages and are exported for
fixture tests. Removed legacy English-only builders had no production callers.
Shared date resolvers and capsule/FAQ builders stay outside this issue's scope.

`template-format.ts` accepts string/number placeholder values, retains unresolved
or nullish tokens, and preserves zero/empty strings. Signed-star and Intl
conjunction formatting accept either a site locale or a language tag. Weekly
movers keep their existing private list punctuation because it differs from Intl
conjunction formatting.

Only `RepoHistorySection` and `RepoMilestonesSection` remain in `repo-sections.tsx`;
their rendering and ranking-link behavior are unchanged. The four unused exports
and their private-only helpers were removed.

## Visual evidence

See [desktop/mobile before and after images](610-screenshots/README.md). The
fixtures include populated pages, absent repository metadata and milestones, and
empty organization members/history. Owner visual sign-off remains required.
