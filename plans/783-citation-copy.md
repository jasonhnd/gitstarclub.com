# Issue 783 citation copy cleanup

Goal: align citation dates with publication metadata in PR 837.

Scope: seven citation translations, the Traditional Chinese yearly title,
and redundant unavailable-year branches in both Pulse implementations.

Out of scope: deployments, data changes, footer wording, and layout changes.

Acceptance: citations describe publication; yearly terminology is consistent;
unavailable-year behavior stays unchanged; requested verification passes.

Verification: the requested install, web coverage, Astro pre build, Worker checks,
and Astro test chain passed (2,471 web tests, 23 Worker checks, 428 Astro tests).
An additional lint:docs run failed on existing unresolved perf script references
in unrelated plans. No deployment was performed.
