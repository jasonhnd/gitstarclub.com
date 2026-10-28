# Issue 855: Astro standard suites

Goal: Run the two missing standard Astro suites against the specified candidate.

Scope: Check candidate identity, prepare verified tools and frozen dependencies, create a synthetic local fixture build as a prerequisite, run each suite independently, and preserve compact evidence.

Out of scope: Tracked code changes, deployment, live data, earlier typecheck or P7 cache repairs, and repeating the prior build and host validation acceptance.

Acceptance: Original suite logs and exit codes, counts and skips, prerequisite details, and unchanged tracked candidate identity are recorded.
