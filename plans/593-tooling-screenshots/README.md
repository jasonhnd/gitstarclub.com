# Issue #593: bounded Playwright screenshot comparison

The before build uses the merged #592 application baseline (`aa175a8`) with
Playwright 1.62.1 and Chromium 151.0.7922.34 (revision 1234). The after build uses
`9cbf3c7`, Playwright 1.63.0 and Chromium 153.0.8010.12 (revision 1243).
Both use the same read-only, missing-data loopback fixture and English pages.
Browser requests outside loopback are blocked.

The committed screenshot generator captured Pulse, Rankings, Categories,
Compare, and About at 1440x1100, 768x1024, 390x1200, and 360x1000, with both
light and dark themes: 40 captures per version. Raw decoded-pixel comparison
finds 38 identical pairs and two pairs with small header edge differences.
No page-body pixels change. The largest per-channel difference is 13/255.
Visual inspection finds the same content and layout. Browser rasterization is
a possible explanation; the exact cause of the edge differences was not isolated.

| Case | Changed pixels | Fraction of image | Before | After |
|---|---|---|---|---|
| Rankings, 1440x1100 light | 129 | 0.008144% | [Before](rankings-1440-light-before.png) | [After](rankings-1440-light-after.png) |
| Rankings, 768x1024 dark | 56 | 0.007121% | [Before](rankings-768-dark-before.png) | [After](rankings-768-dark-after.png) |

These are newly captured evidence files, not replacements for existing golden
baselines. The bounded fixture covers static chrome and empty states; populated
ranking/curve data, other locales, and live previews were not browser-tested.
