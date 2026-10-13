# Issue 613 visual evidence

Screenshots use local Microsoft Edge at 1440 x 1000 (desktop) and 390 x 844 (mobile), device scale 1, light theme, animations disabled, fonts fully loaded. All 24 captures have no horizontal document overflow.

The bounded fixture renders the actual localized organization, comparison, and category page components with fixed precomputed data. Before uses `origin/pre` at `b9650f0`; after uses the implementation in this PR. Both use the same built application stylesheet, locally served Plus Jakarta Sans and Geist Mono fonts, and the actual footer. The workbench is captured in its initial server-rendered state. Browser requests are restricted to loopback; no real storage or platform API is used.

For the before partial-error and all-error comparisons, the page component throws before returning any workbench. The fixture displays a clearly labeled "Server render failed" response to document that failure. This response is a fixture diagnostic, not a screenshot of the deployed site's error template. After captures show the real rendered page, remaining successful summaries, localized unavailable-pair copy, and workbench.

Successful organization, comparison, and category output is also checked against fixed baseline HTML SHA-256 values in all seven locales. Browser rasterization can vary slightly between captures; the HTML contract is byte-for-byte stable. Client interactions are verified separately against the local built Next application.

| State | Desktop before | Desktop after | Mobile before | Mobile after |
| --- | --- | --- | --- | --- |
| Organization success | [Before](org-success-desktop-before.png) | [After](org-success-desktop-after.png) | [Before](org-success-mobile-before.png) | [After](org-success-mobile-after.png) |
| Organization empty | [Before](org-empty-desktop-before.png) | [After](org-empty-desktop-after.png) | [Before](org-empty-mobile-before.png) | [After](org-empty-mobile-after.png) |
| Comparison success | [Before](compare-success-desktop-before.png) | [After](compare-success-desktop-after.png) | [Before](compare-success-mobile-before.png) | [After](compare-success-mobile-after.png) |
| Comparison partial error | [Before](compare-partial-desktop-before.png) | [After](compare-partial-desktop-after.png) | [Before](compare-partial-mobile-before.png) | [After](compare-partial-mobile-after.png) |
| Comparison all examples fail | [Before](compare-empty-desktop-before.png) | [After](compare-empty-desktop-after.png) | [Before](compare-empty-mobile-before.png) | [After](compare-empty-mobile-after.png) |
| Category success | [Before](categories-success-desktop-before.png) | [After](categories-success-desktop-after.png) | [Before](categories-success-mobile-before.png) | [After](categories-success-mobile-after.png) |

Owner screenshot sign-off is required before merge. The executor does not merge this PR.
