# Issue 783: yearly empty-state labels, round 2

## Goal
Distinguish missing yearly coverage from available all-time history on home and Pulse.

## Scope
Use the existing shared yearly availability rule for the year title, pill, period card, leader metadata, and hidden full-board link. Add localized copy in all seven dictionaries. Label the About this data timestamp as publication. Extend rendered acceptance tests and document the behavior.

## Out of scope
Data, footer, deployment, secrets, routes, and populated yearly presentation remain unchanged.

## Acceptance
Home and Pulse render consistent empty labels and preserve populated rows in English and Japanese; all seven dictionaries retain parity. Run the requested full web coverage suite, preview build, Worker checks, and Astro suite. Finally capture light-mode English desktop and Japanese mobile evidence without committing images.

## Verification results
- Requested install, full web coverage suite, preview build, Worker checks, and Astro suite: passed on bddb3b6. Web: 2,470 passed, 49 skipped, 0 failed; coverage 90.48% lines and 91.05% functions. Worker: 23 passed. Astro: 428 passed, including home/Pulse fallback, unavailable, and populated cases in English and Japanese and publication labels.
- Dictionary recursive key parity passed for all seven locales.
- Additional checks: runtime contract, web dependency audit, CI gate assertion, 208 pipeline tests, web lint (existing warnings only), all three web type checks, and generated-view validation passed.
- Existing blockers outside this issue: pipeline dependency audit reports high advisories for undici 6.28.1 and zod 4.1.11; documentation lint reports unresolved script paths in existing plans 760, 779, 781, 824e, and astro-accept-1. No unrelated dependencies or plans were changed.
- Verification stayed in the current checkout as explicitly required by the card; no detached clone or branch switch. Runtime was the installed Node 24.21.0 and Bun 1.4.2.
- Final visual evidence uses the built preview with homeYearFixture("fallback"), a fresh Chromium profile, and light mode. Images are saved outside Git at the owner's requested evidence paths.
