# BLOCKED — independent review in progress

Source verdict: provisionally APPROVE; complete gates and final custody checks pending. Integration and release are not authorized. This independent review does not replace the required other-vendor review.

Product candidate: 0440856e561a84a183163cdf951959e1461b8ef5; product tree: 66374e7d55eb3767a73bb90b9b2e5cc973755910; frozen base: 179e4682325acdc742ea69d2452d292f8175ac50. The report-only commit is not product code and must never be published or merged as such.

Must: pipeline audit failed on four high advisories in unchanged dependencies. All remaining gates are in progress. Should: none identified. Nits: none identified.

All six allowed files pass scope inspection: 760 preview guard, 779 footer date, 781 refresh releases, 824e rollback, Astro acceptance baseline, and 853 task plan. The new plan states goal, scope, exclusions and acceptance in English and uses Refs #853. Full diff inspection found historical failures, counts, measurements and qualifiers preserved. The checker, negative-path tests, historical and generated allowlists, runtime, dependencies, locks and CI are unchanged. The baseline already contained Astro prefixes, but the unchanged extractor finds the embedded root scripts substrings. Current links are explicitly attached to past failures and do not claim those tests passed.

Each row below had the indicated root scripts reference extracted on base; the replacement is relative to its plan, and the resolved maintained file exists with the intended identity. All ten independent checks passed.

| Plan | Before | After (relative link) | Target exists |
| --- | --- | --- | --- |
| 760 | scripts/perf-local.ts | ../astro/scripts/perf-local.ts | yes |
| 760 | scripts/perf-metrics.ts | ../astro/scripts/perf-metrics.ts | yes |
| 779 | scripts/perf-local.ts | ../astro/scripts/perf-local.ts | yes |
| 779 | scripts/perf-metrics.ts | ../astro/scripts/perf-metrics.ts | yes |
| 781 | scripts/perf-local.ts | ../astro/scripts/perf-local.ts | yes |
| 781 | scripts/perf-metrics.ts | ../astro/scripts/perf-metrics.ts | yes |
| 824e | scripts/perf-local.ts | ../astro/scripts/perf-local.ts | yes |
| 824e | scripts/perf-metrics.ts | ../astro/scripts/perf-metrics.ts | yes |
| Astro baseline | astro/scripts/perf-local.ts (embedded root substring extracted) | ../astro/scripts/perf-local.ts | yes |
| Astro baseline | astro/scripts/perf-metrics.ts (embedded root substring extracted) | ../astro/scripts/perf-metrics.ts | yes |

Bootstrap verified official archive checksums for Node 24.20.0 and Bun 1.4.2. The complete stage results, timing and logs are being accumulated in summary.json and the per-stage logs under ~/evidence. Web audit passed; pipeline audit failed with three undici 6.28.1 high advisories and one zod 4.1.11 high advisory. Pipeline and web manifest and lock blobs match base. Aggregate static is FAILED regardless of downstream results.
