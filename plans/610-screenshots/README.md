# Issue 610 visual evidence

Local Microsoft Edge, local Next development server, GET/HEAD-only loopback JSON
fixtures. No live data or credentials. Baseline source: `pre` at `b9650f0`;
after source: issue 610's committed refactor. Desktop viewport: 1440 x 1000;
mobile viewport: 390 x 844. Images capture the full page, after fonts/animations
settle and the page is scrolled through to reveal below-fold content. Only the
Next development overlay is omitted.

Seven before/after pairs are pixel-identical. The repository mobile pair has 51
pixel differences in a 47 x 2 area on the bottom edge of the unchanged SVG star
chart; its layout, text, and links are unchanged. All captured pages have no
horizontal document overflow. These fixture screenshots do not prove live data
or deployed rendering. Owner visual sign-off is required before merge.

The populated repository includes metadata, an exact milestone, and history. The
empty repository has only identity and zero stars, without metadata, milestones,
or history. The populated organization includes a member and combined history;
the empty organization has neither members nor monthly history.

| Scene | Before | After | Different pixels |
| --- | --- | --- | ---: |
| repo-desktop | [Before](repo-desktop-before.png) | [After](repo-desktop-after.png) | 0 |
| repo-mobile | [Before](repo-mobile-before.png) | [After](repo-mobile-after.png) | 51 |
| repo-empty-desktop | [Before](repo-empty-desktop-before.png) | [After](repo-empty-desktop-after.png) | 0 |
| repo-empty-mobile | [Before](repo-empty-mobile-before.png) | [After](repo-empty-mobile-after.png) | 0 |
| org-desktop | [Before](org-desktop-before.png) | [After](org-desktop-after.png) | 0 |
| org-mobile | [Before](org-mobile-before.png) | [After](org-mobile-after.png) | 0 |
| org-empty-desktop | [Before](org-empty-desktop-before.png) | [After](org-empty-desktop-after.png) | 0 |
| org-empty-mobile | [Before](org-empty-mobile-before.png) | [After](org-empty-mobile-after.png) | 0 |
