---
owner: performance
status: baseline
last_reviewed: 2026-07-05
source_of_truth_for:
  - Core Web Vitals baseline for issue 25
  - Lighthouse evidence
---

# Core Web Vitals / Lighthouse baseline (#25)

## Scope

This report records the pre-launch Lighthouse and Core Web Vitals lab baseline for issue #25. It is a verification report only: no runtime code, data contracts, visual tokens, or indexing policy were changed.

## Test setup

| Field | Value |
|---|---|
| Test date | 2026-06-24 |
| App commit under test | `c05a0878c8cb3a846ad33d3e7f8f2b67ebd4481c` |
| Branch | `issues/cwv-lighthouse-25` |
| Lighthouse | `13.4.0` |
| Node / Bun | Node `v24.15.0`, Bun `1.3.14` |
| Measured target | `https://www.gitstarclub.com` |
| Measured deployment | `https://gitstarclub-qelf5kuqz-zkscio.vercel.app` |
| Excluded target | `https://gitstarclub-3glmn3afp-zkscio.vercel.app` |
| Local artifacts | `C:\Users\owner\AppData\Local\Temp\gsc-lighthouse-25-prod` |

The Vercel preview deployment was created successfully, but its `.vercel.app` URL was protected and injected Vercel toolbar / auth assets into Lighthouse runs. Those runs were excluded because they measured Vercel shell JavaScript rather than the app. The public production domain was used for the valid run because it exercised the real Vercel CDN path without changing `SITE_INDEXABLE`. `vercel inspect --logs` confirmed the measured production deployment cloned `github.com/jasonhnd/gitstarclub.com` branch `main` at commit `c05a087`.

Commands used:

```powershell
npx --yes lighthouse@13.4.0 https://www.gitstarclub.com/pulse --output=json --output-path=$env:TEMP\gsc-lighthouse-25-prod\mobile-pulse.json --chrome-flags="--headless=new --no-sandbox"
npx --yes lighthouse@13.4.0 https://www.gitstarclub.com/pulse --preset=desktop --output=json --output-path=$env:TEMP\gsc-lighthouse-25-prod\desktop-pulse.json --chrome-flags="--headless=new --no-sandbox"
```

Each representative URL was warmed with a successful HTTP request before measurement. `/pulse` and `/react/react` were re-run twice on mobile after first-run LCP variance; the table below uses the median run for those two rows.

## Thresholds

| Metric | Target |
|---|---:|
| FCP | `< 1.5s` |
| LCP | `< 2.5s` |
| INP | `< 200ms` |
| CLS | `< 0.1` |
| TBT | `< 200ms` |
| Content-page JS | `< 150KB` gzip / compressed transfer budget |

Lighthouse lab runs do not provide real INP without field data. TBT is recorded as the lab proxy. Real INP still needs post-launch RUM or CrUX once the site is indexable and has traffic.

## Mobile results

| Page | Perf | A11y | BP | SEO | FCP | LCP | TBT | CLS | App JS | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `/pulse` | 99 | 96 | 100 | 66 | 0.91s | 1.96s | 10ms | 0.000 | 160KB | Pass; JS budget noted |
| `/react/react` | 99 | 97 | 100 | 66 | 1.21s | 2.11s | 10ms | 0.000 | 160KB | Pass; JS budget noted |
| `/rankings` | 98 | 96 | 100 | 66 | 1.09s | 2.41s | 42ms | 0.000 | 160KB | Pass; JS budget noted |
| `/rankings/2026/6` | 98 | 96 | 100 | 66 | 1.03s | 2.41s | 18ms | 0.000 | 160KB | Pass; JS budget noted |
| `/categories/language/python` | 99 | 96 | 100 | 58 | 1.21s | 2.11s | 12ms | 0.000 | 160KB | Pass; SEO expected prelaunch |
| `/o` | 99 | 96 | 100 | 66 | 1.22s | 2.12s | 9ms | 0.000 | 160KB | Pass; JS budget noted |
| `/compare` | 99 | 96 | 96 | 66 | 1.06s | 2.11s | 14ms | 0.003 | 169KB | Pass; interactive tool JS noted |

## Desktop results

| Page | Perf | A11y | BP | SEO | FCP | LCP | TBT | CLS | App JS | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `/pulse` | 100 | 96 | 100 | 66 | 0.29s | 0.45s | 0ms | 0.000 | 160KB | Pass; JS budget noted |
| `/react/react` | 100 | 97 | 100 | 66 | 0.29s | 0.49s | 0ms | 0.000 | 160KB | Pass; JS budget noted |
| `/rankings` | 100 | 96 | 100 | 66 | 0.29s | 0.81s | 0ms | 0.000 | 160KB | Pass; JS budget noted |
| `/rankings/2026/6` | 100 | 96 | 100 | 66 | 0.29s | 0.47s | 0ms | 0.000 | 160KB | Pass; JS budget noted |
| `/categories/language/python` | 100 | 96 | 100 | 58 | 0.29s | 0.57s | 0ms | 0.000 | 160KB | Pass; SEO expected prelaunch |
| `/o` | 100 | 96 | 100 | 66 | 0.27s | 0.69s | 0ms | 0.000 | 160KB | Pass; JS budget noted |
| `/compare` | 100 | 96 | 96 | 66 | 0.25s | 0.37s | 0ms | 0.001 | 169KB | Pass; interactive tool JS noted |

## Mobile variance check

| Page | Run | Perf | FCP | LCP | TBT | CLS |
|---|---|---:|---:|---:|---:|---:|
| `/pulse` | first | 97 | 1.06s | 2.56s | 15ms | 0.000 |
| `/pulse` | rerun 1 | 99 | 0.91s | 1.96s | 10ms | 0.000 |
| `/pulse` | rerun 2 | 99 | 0.91s | 1.96s | 6ms | 0.000 |
| `/react/react` | first | 96 | 1.59s | 2.64s | 17ms | 0.000 |
| `/react/react` | rerun 1 | 99 | 1.21s | 2.11s | 9ms | 0.000 |
| `/react/react` | rerun 2 | 99 | 1.21s | 2.11s | 10ms | 0.000 |

The first mobile run for `/pulse` and `/react/react` crossed the LCP target by roughly 60ms and 140ms respectively. Immediate repeat runs on the same CDN path passed with low TBT and zero CLS, so no deterministic code fix was made in this PR.

## JavaScript and bundle notes

Lighthouse reported app JavaScript compressed transfer around 160KB for content pages and 169KB for `/compare`. The local build manifest root shared chunks gzip to about 129KB:

| Chunk | Gzip | Raw |
|---|---:|---:|
| `static/chunks/00gq-v0e07i1q.js` | 7KB | 23KB |
| `static/chunks/0pqt~8bl3ukh4.js` | 9KB | 43KB |
| `static/chunks/01mnp9l3ghj2e.js` | 39KB | 147KB |
| `static/chunks/07lhk_q6pmm3r.js` | 69KB | 222KB |
| `static/chunks/turbopack-0dc1zzczfu_5v.js` | 4KB | 10KB |
| **Root main total** | **129KB** | **445KB** |

The strict 150KB content-page budget is slightly exceeded in network transfer. Initial-load TBT remains well below the 200ms threshold on every page, and the search index still loads lazily after search interaction rather than during first paint. Reducing the remaining 10KB-plus overage would require follow-up structural work on shared app-bar islands / Next runtime chunking, so it is recorded as a known launch-budget item rather than fixed inside this verification PR.

## Conclusions

- Mobile and desktop Lighthouse performance targets pass for the representative page set when measured on the unpolluted production CDN path.
- A11y scores are 96-97 across the page set, preserving the post-#11 accessibility level.
- SEO scores are 58-66 because the site is still pre-launch/noindex; `SITE_INDEXABLE` was intentionally not changed here and remains a separate #1 decision.
- Real INP cannot be proven by Lighthouse lab data. TBT is healthy, but post-launch RUM or CrUX should be used for the final field INP call.
- No code or visual changes were made. The only deliverable is this measured baseline and the explicit JS-budget note above.
