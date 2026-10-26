---
owner: product
status: complete
last_reviewed: 2026-10-26
source_of_truth_for:
  - Issue 799 organization About this data placement
---

# Issue 799: About this data on organization pages

## Goal

Show the About this data disclosure on every `/o/<login>` page, in every locale, under the answer capsule and before the FAQ.

## Scope

- Pass the organization page's current totals and history curve, using that request's meta, release id, canonical URL and document title.
- Pass published daily-history coverage only when the page shows those daily points.
- Assert English and Japanese renders for organization and developer owner pages.
- Capture 1440 and 390 screenshots for one organization page in English and Japanese.

## Out of scope

Component redesign, other product pages, deployment, secrets, and branch changes. The component stays as shipped in #780 unless placement uncovers a bug.

## Acceptance

The disclosure renders from the current meta on both organization page types in English and Japanese. Desktop and mobile screenshots show one organization page in both locales.
