# Issue 615: Pure test fixtures

## Goal

Consolidate duplicated rank fixture construction, versioned view-key parsing,
and HTML decoding without changing page output or losing sparse-data coverage.

## Scope

Change only the six test/runner files listed in issue #615 and add helpers under
`web/lib/integration/fixtures/`. This required plan records the implementation
and verification. Extract the UI/UX suite's fixture data into a pure module;
keep suite hooks, mocks, and scenario controls local. Splitting the unrelated
contract and source suites is optional and will be deferred unless needed.

## Out of scope

Production application behavior, visual changes, dependency or lockfile changes,
CI/deployment configuration, live data, credentials, merges, and protected-branch
pushes. Do not mock `@/lib/periods` or leak fetch replacements between suites.

## Acceptance

- Preserve all existing scenarios, including sparse and missing data.
- Use shared pure helpers with suite-specific rank values and availability.
- Restore global fetch and environment variables in existing suite cleanup.
- Pass the complete isolated web suite and the documented static job plus
  fixture production build using pinned Node/Bun and a clean environment.
- Record verification evidence and limitations in a PR targeting `pre` with
  `Closes #615`; hand off for independent Claude-family review.
