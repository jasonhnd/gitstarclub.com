# Issue 798: Add About this data to repository pages

## Goal

Show the existing About this data disclosure on every English and localized repository page.

## Scope

- Pass the repository page's captured metadata and release version to the existing disclosure renderer.
- Place it after the answer capsule and before repository history and the FAQ.
- Cite the page's rendered title and locale-specific canonical URL, and identify the history curve layer and its published daily coverage when present.
- Add route coverage proving the disclosure renders with the current metadata and captured release.

## Out of scope

- Changing the disclosure component, its copy, or its behavior.
- Adding the block to other page types or changing publication/data contracts.
- Deploying or changing branches.

## Acceptance

- English and Japanese repository pages render the disclosure using current page metadata and the captured release identity.
- Tests verify its placement, data layer, and citation inputs.
- Capture 1440 px and 390 px screenshots for English and Japanese repository pages.
