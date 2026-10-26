# Issue #823: Mobile navigation fade

## Goal
Blend the mobile navigation right-edge fade into the header surface in both themes.

## Scope
Reuse the existing surface token in the shared navigation background, add a style
regression check, and document the behavior.

## Out of scope
New tokens, desktop changes, deployment, and committed screenshots.

## Acceptance
At 390px the light and dark fades have no amber tint. A style check covers both
surface layers and the desktop reset. Run the requested full web coverage suite,
Astro preview build, Worker checks, and Astro tests after one small commit.
