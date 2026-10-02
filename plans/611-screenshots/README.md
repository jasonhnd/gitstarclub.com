# Issue 611 visual evidence

Baseline: `origin/pre` at `b9650f0`. Visual implementation: `4e6e098`. A subsequent caller-policy wrapper change has identical rendered output; the final head is verified separately.

Captured with the local Microsoft Edge executable, light mode, reduced motion, and full-page PNG output. Desktop viewport: 1440 x 1000. Mobile viewport: 390 x 844. All 44 captures have no horizontal document overflow.

These are the real server-rendered page components with fixed synthetic read fixtures, repository Tailwind CSS, and locally served Plus Jakarta Sans / Geist Mono fonts. Client islands are not hydrated; this is layout and server-output evidence, not a deployed-browser or clipboard acceptance test. Empty fixtures contain published rank views with no rows; period metadata remains available, and the year sample retains one published movement cell. No real bucket or production endpoint was accessed.

All 70 populated/empty page HTML fixtures across seven locales match the baseline exactly. All 20 populated/empty desktop/mobile image pairs are pixel-identical. Only the two sparse-archive pairs differ: the nonexistent 2025 December/final-week buttons disappear; year links remain.

Owner screenshot sign-off is required before merge.

| Family | State | Desktop before | Desktop after | Mobile before | Mobile after |
|---|---|---|---|---|---|
| pulse | populated | [before](pulse-populated-desktop-before.png) | [after](pulse-populated-desktop-after.png) | [before](pulse-populated-mobile-before.png) | [after](pulse-populated-mobile-after.png) |
| pulse | empty | [before](pulse-empty-desktop-before.png) | [after](pulse-empty-desktop-after.png) | [before](pulse-empty-mobile-before.png) | [after](pulse-empty-mobile-after.png) |
| rankings | populated | [before](rankings-populated-desktop-before.png) | [after](rankings-populated-desktop-after.png) | [before](rankings-populated-mobile-before.png) | [after](rankings-populated-mobile-after.png) |
| rankings | empty | [before](rankings-empty-desktop-before.png) | [after](rankings-empty-desktop-after.png) | [before](rankings-empty-mobile-before.png) | [after](rankings-empty-mobile-after.png) |
| year | populated | [before](year-populated-desktop-before.png) | [after](year-populated-desktop-after.png) | [before](year-populated-mobile-before.png) | [after](year-populated-mobile-after.png) |
| year | empty | [before](year-empty-desktop-before.png) | [after](year-empty-desktop-after.png) | [before](year-empty-mobile-before.png) | [after](year-empty-mobile-after.png) |
| month | populated | [before](month-populated-desktop-before.png) | [after](month-populated-desktop-after.png) | [before](month-populated-mobile-before.png) | [after](month-populated-mobile-after.png) |
| month | empty | [before](month-empty-desktop-before.png) | [after](month-empty-desktop-after.png) | [before](month-empty-mobile-before.png) | [after](month-empty-mobile-after.png) |
| week | populated | [before](week-populated-desktop-before.png) | [after](week-populated-desktop-after.png) | [before](week-populated-mobile-before.png) | [after](week-populated-mobile-after.png) |
| week | empty | [before](week-empty-desktop-before.png) | [after](week-empty-desktop-after.png) | [before](week-empty-mobile-before.png) | [after](week-empty-mobile-after.png) |
| rankings | sparse | [before](rankings-sparse-desktop-before.png) | [after](rankings-sparse-desktop-after.png) | [before](rankings-sparse-mobile-before.png) | [after](rankings-sparse-mobile-after.png) |
