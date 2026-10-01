# Issue 612: Korean category copy evidence

These full-page screenshots show the actual localized `/ko/categories` page in
local Microsoft Edge, using only a read-only GET/HEAD fixture at loopback.
Desktop viewport: 1440 x 1000. Mobile viewport: 390 x 844.

Before: `origin/pre` at `b9650f0`. After: implementation at `6095860`.
Both use the same date (June 24, 2026), three dimensions (language, ecosystem,
domain), and fixture counts. The empty fixture retains those dimensions but
has no categories. The development server and its data cache were restarted
between fixture modes; the empty page was verified to contain no table.

The intentional change appears in the answer capsule and the second FAQ:
Korean conjunction replaces the previous English `and`. Both widths have no
horizontal document overflow. Owner screenshot sign-off is required before
merge. No live bucket, platform API, or deployed page was used.

| State | Before | After |
| --- | --- | --- |
| Populated desktop | [Before](categories-desktop-before.jpg) | [After](categories-desktop-after.jpg) |
| Populated mobile | [Before](categories-mobile-before.jpg) | [After](categories-mobile-after.jpg) |
| Empty desktop | [Before](categories-empty-desktop-before.jpg) | [After](categories-empty-desktop-after.jpg) |
| Empty mobile | [Before](categories-empty-mobile-before.jpg) | [After](categories-empty-mobile-after.jpg) |

All transient fixture programs, baseline output JSON, and logs are retained
outside the checkout at `/tmp/GSC_0056/` for independent review.
