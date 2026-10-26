# Issue #796: About this data on home and Pulse

## Goal
Place the existing About this data disclosure on every home and Pulse page, after the answer capsule and before the FAQ, with route-specific citation details and the publication metadata used by the page.

## Scope
- Pass captured publication metadata and release identity to the home and Pulse renderers.
- Render the existing disclosure with the `periodGains` layer, canonical page URL, and localized page title.
- Cover the home and Pulse render paths in English and Japanese, including metadata and layer assertions.
- Fix any component integration issue required to render the disclosure.

## Out of scope
- Changes to disclosure copy or component design.
- Other page families, deployments, or secrets.

## Acceptance
- Home and Pulse pages in English and Japanese include the disclosure after the answer capsule and before the FAQ.
- Tests assert the disclosure uses current metadata and the `periodGains` layer.
- The specified Astro build and test commands pass.
