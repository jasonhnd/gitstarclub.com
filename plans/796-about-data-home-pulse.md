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

## Rework verification
Tested code commit: `d4085d9` on the existing `ib/gsc-796-r1` branch. Used Node 24.20.0 and Bun 1.4.2. Owner instructions require verification in this workspace, overriding the older detached-clone and external temporary-directory guidance.

- Frozen installs at root, pipeline, web and Astro: passed; no lockfile changes.
- Conflict-marker search: no matches. Diff checks against `origin/feat/trusted-archive-v01`: passed. The Copy module matches that base exactly.
- Astro full test suite: 367 passed, zero failed.
- Astro typecheck: passed, zero errors, with 14 existing hints.
- Astro `build:pre` from clean generated output directories: passed.
- Astro `test:worker -- --timeout 30000`: eight passed, zero failed. The browser regression checks English/Japanese home and Pulse Copy, document title/canonical citation parity, both method links, and no enhancement on rankings, compare or about.
- Pipeline tests: 205 passed, zero failed.
- Web lint, all three typechecks and view fixture validation: passed.
- Full offline web coverage suite: 2,172 passed, 49 skipped, zero failed. Coverage gate passed: 90.11% lines and 90.70% functions.
- Static job remains blocked by existing pipeline dependency audit findings (`undici` 6.28.1 and `zod` 4.1.11) and documentation path checks in the unrelated plans numbered 760 and astro-accept-1. Remaining static checks were run separately after those failures. Dependency versions and unrelated plans were left unchanged.
- English/Japanese home and Pulse screenshots at desktop/mobile widths are saved only in ignored card-local scratch. Before images reconstruct the reviewed appearance (Copy hidden, period gains only), since the conflicted starting commit could not build. After images use the real built Worker.
- No screenshots or generated output are committed. GitHub CLI authentication is unavailable, so no remote issue or pull request was updated.
