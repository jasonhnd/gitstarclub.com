# Issue #796: About this data on home and Pulse

## Goal
Place the existing About this data disclosure on every home and Pulse page, after the answer capsule and before the FAQ, with route-specific citation details and the publication metadata used by the page.

## Scope
- Pass captured publication metadata and release identity to the home and Pulse renderers.
- Render the existing disclosure with the `periodGains` layer and additional `currentTotals` disclosure, canonical page URL, and localized page title.
- Cover the home and Pulse render paths in English and Japanese, including metadata and layer assertions.
- Fix any component integration issue required to render the disclosure.

## Out of scope
- New locale copy or changes to component design.
- Other page families, deployments, or secrets.

## Acceptance
- Home and Pulse pages in English and Japanese include the disclosure after the answer capsule and before the FAQ.
- Tests assert the disclosure uses current metadata and the `periodGains` layer.
- The specified Astro build and test commands pass.

## Rework round 1
- Resolve committed conflict markers while preserving the trusted-archive component.
- Share canonical URL and document title calculation with the layout.
- Load Copy only from home and Pulse client scripts, never server frontmatter.
- Extend the component with optional additional layers so both period gains and current totals have method links.
- Add English/Japanese page render tests with captured publication metadata and changed counts/dates.
- Run clean Astro pre build, worker tests, full Astro tests and repository static checks in place; keep temporary artifacts inside this workspace per owner instructions.
