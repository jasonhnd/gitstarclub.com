# Issue 687 visual evidence

Full-page Chromium captures at a 1440 x 1100 viewport, dark theme and reduced
motion, using the normal Next.js routes and a read-only local fixture. Before:
`6199293`; after: `ebd121f`. Both environments used archive-verified Node 24.20.0
and Bun 1.4.2. Generated output and browser profiles stayed in the excluded card
directory. These images are permanent PR evidence, not temporary build output.

The synthetic repository is `example/star-history` (id 42). Both fixtures have
identical monthly points (September gain 1000; ending total 24000), daily values
and weekly ranking rows. The after fixture additionally propagates GSC_0090's
exact optional provenance object to its daily curve and weekly rank metadata.
The before schema predates that optional field. No real repository measurements
were fetched or changed. A clean build cache separates the two captures.

The previous repo page rendered only monthly cumulative totals. The new page
keeps that chart and adds a separate daily-count curve for source-marked gap
observations. The note appears above that daily chart and below the weekly hero.
The monthly page keeps its published totals and contains no source note. Rendered
text checks confirmed these expectations in both locales. The separate regression
tests also check unmarked data on the new implementation and marked metadata on
monthly ranks.

| Route | English before / after | Japanese before / after |
| --- | --- | --- |
| `/example/star-history` | [Before](en-repo-before.png) / [After](en-repo-after.png) | [Before](ja-repo-before.png) / [After](ja-repo-after.png) |
| `/rankings/2026/W39` | [Before](en-week-before.png) / [After](en-week-after.png) | [Before](ja-week-before.png) / [After](ja-week-after.png) |
| `/rankings/2026/9` | [Before](en-month-before.png) / [After](en-month-after.png) | [Before](ja-month-before.png) / [After](ja-month-after.png) |

Japanese captures use the corresponding `/ja` prefix. Owner visual sign-off
remains required before merge; these captures are execution evidence.
