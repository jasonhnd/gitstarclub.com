# APPROVE — source review; delivery BLOCKED

The documentation candidate meets the requested source scope. The aggregate static gate FAILED because the unchanged pipeline dependencies have four high-severity advisories. Integration and release are blocked; this independent review does not replace the required other-vendor source review and does not authorize merge or release.

Reviewed product candidate at start and end: 0440856e561a84a183163cdf951959e1461b8ef5. Product tree at start and end: 66374e7d55eb3767a73bb90b9b2e5cc973755910. Frozen base: 179e4682325acdc742ea69d2452d292f8175ac50. Current branch stayed unchanged. The report-only commits are evidence carriers and must never be published or merged as product code.

Must: resolve the separate pipeline dependency audit failure and obtain the required other-vendor source review before integration. The audit reports undici 6.28.1 advisories GHSA-xjj6-f33q-929c, GHSA-2m5v-pch6-74hx and GHSA-qrxm-fqhp-jwvm, and zod 4.1.11 advisory GHSA-mrhx-c7xc-m3w5. The pipeline and web manifest and lock blobs are identical to base; no dependency fix was imported. Should: none identified. Nits: none identified.

All six permitted files pass scope inspection: 760 preview guard, 779 footer date, 781 refresh releases, 824e rollback, Astro acceptance baseline, and the 853 task plan. The English task plan states goal, scope, exclusions and acceptance and uses Refs #853. The actual pull request body was not inspected; its lifecycle wording remains an external check. The full diff preserves historical failures, first-failure counts, measurements, dates, limits and qualifiers. The corrected links do not imply historical tests passed. No unrelated prose or evidence was discarded. Only these six paths differ from base. The checker and negative-path tests, historical and generated allowlists, runtime, dependencies, locks and CI are byte-identical to base; no suppressions or placeholders were introduced.

The baseline already used Astro prefixes. The original extractor reads the embedded root scripts substring inside inline code. An independent scratch negative probe confirmed both that behavior and rejection of a missing path; no tracked tests were edited.

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


## Executable gates

Each command and its complete output is in the corresponding stage log under ~/evidence. All stages were attempted independently after audit failure; elapsed time is wall-clock seconds. A dash means the command has no meaningful test count. The full documentation chain uses short-circuit execution, so its zero exit confirms every listed substage passed.

| Stage | Exit | Seconds | Counts or result |
| --- | ---: | ---: | --- |
| bootstrap | 0 | 3.58 | Official Node and Bun archive checksums and version checks passed |
| runtime | 0 | 0.03 | Node 24.20.0; Bun 1.4.2 |
| web_install | 0 | 3.64 | 536 packages installed with frozen lock |
| web_audit | 0 | 0.06 | 587 packages checked; no high or greater findings; 4 below threshold |
| web_graph | 0 | 0.02 | 681 graph nodes |
| cf_gate | 0 | 0.06 | Configuration assertion passed |
| pipeline_install | 0 | 0.32 | 36 packages installed with frozen lock |
| pipeline_audit | 1 | 0.12 | 4 high advisories: 3 undici and 1 zod |
| pipeline_tests | 0 | 42.0 | 211 passed, 0 failed, 12 files; 1,352 expectations |
| docs_full | 0 | 0.37 | Markdown fences passed; 50 tests passed, 0 failed; documentation consistency passed; final CF assertion passed |
| web_lint | 0 | 11.54 | 0 errors, 14 warnings |
| web_typecheck | 0 | 6.89 | No count reported |
| web_typecheck_tests | 0 | 7.83 | No count reported |
| web_typecheck_scripts | 0 | 1.59 | No count reported |
| views | 0 | 0.07 | 15 discovered and validated, 0 skipped, 0 failed |
| web_coverage | 0 | 147.88 | 2,673 passed, 49 skipped, 0 failed; 225 files; lines 90.53%, functions 91.12%; floor 80% |
| astro_install | 0 | 0.63 | 340 packages installed with frozen lock |
| astro_graph | 0 | 0.03 | Exact pins and runtime checks passed |
| fixture_ready | 0 | - | Synthetic read-only loopback fixture started |
| web_build_production | 0 | 12.64 | Production build completed |
| web_host_production | 0 | 0.03 | 234 routes, 467 artifacts |
| web_graph_production | 0 | 0.02 | 681 graph nodes |
| web_build_pre | 0 | 10.75 | Pre build completed |
| web_host_pre | 0 | 0.03 | 234 routes, 467 artifacts |
| web_graph_pre | 0 | 0.02 | 681 graph nodes |
| astro_build_production | 0 | 4.37 | Production build completed |
| astro_host_production | 0 | 1.27 | 18 local aggregate import guard cases passed |
| astro_graph_production | 0 | 0.03 | Graph passed |
| astro_build_pre | 0 | 3.34 | Pre build completed |
| astro_host_pre | 0 | 1.12 | 22 local aggregate import guard cases passed |
| astro_graph_pre | 0 | 0.03 | Graph passed |

The 80% coverage floor is unchanged. The web test skips include intentionally disabled live or unavailable local-data cases; no live opt-ins, real environment files, real site or bucket access, paid APIs, deployment, or browser were used. Official checksum-verified toolchains and registry access were the permitted network exceptions. The loopback server accepts GET and HEAD only; Astro host checks use an in-memory local Worker fixture.

The exact candidate product files were tested in the current checkout as required by the custody override. The builds stamped review-only carrier f2d17014aea8d99a789bec7310c4d2b42527589f, not the product commit, because the required evidence commit had already been made and branch switching was forbidden. The carrier differs from the product candidate only by REVIEW.md. Thus build identity itself was not verified as the product SHA; host behavior was validated on identical product files. The final carrier SHA and final status are recorded in the external identity log.

The product-versus-carrier diff excluding REVIEW.md was empty; the tracked working tree was clean before the final report update. Candidate diff whitespace check passed. Final status and the same excluded-report diff are checked again after the final report commit. The retained replay runner, machine-readable summary, source probe, exact candidate diff and full stage logs are under ~/evidence. No mandatory test or fixture build remains unexecuted; the audit failure and independent vendor review remain blockers.
