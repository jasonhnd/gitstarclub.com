# Astro acceptance step 1: current preview baseline

## Plan

- Goal: record the current preview before the Astro deployment for issue #751.
- Scope: public GET requests to the preview deployment, five performance samples for each of the 14 reference paths, and at most 2,000 sitemap page URLs covering every listed page type and all seven locales.
- Out of scope: production, deployment, Cloudflare version identifiers, live service writes, and code, configuration, or test changes.
- Acceptance: deployment commit, 14-row performance table, and crawl counts with every failing URL listed.

## Deployment

| Field | Value |
| --- | --- |
| Preview | https://pre.gitstarclub.com |
| Public deployment endpoint | https://pre.gitstarclub.com/.well-known/deployment |
| `commitSha` (Git commit identifier) | `96b618933baadab7ebb622580c3da05efbb15f5f` |
| Identity recheck | Same commit before and after measurements |
| Performance interval (UTC) | 2026-10-25T10:14:59.464Z to 2026-10-25T10:30:23.315Z |
| Crawl interval (UTC) | 2026-10-25T10:15:27.925Z to 2026-10-25T10:20:08.786Z |
| Measurement source tree | `feat/astro-site`, `154207e4d612594f174e59f9196de2839163b511`; current branch remained `ib/gsc-751` |

## Performance

Adapted [performance runner](../astro/scripts/perf-local.ts) and [performance metrics](../astro/scripts/perf-metrics.ts) in a temporary, uncommitted Playwright script because the originals only accept local hosts and start local build processes. The target origin and local orchestration were adapted; HTTP 404 pages were also allowed explicitly so the two unavailable reference paths could be measured. The same seven paths and their Japanese equivalents were measured sequentially, five samples each, after one server-cache warmup GET per path. Each sample used a fresh browser context, a 1440 x 1000 desktop viewport, en-US locale, blocked service workers, and disabled HTTP cache. The browser used a new temporary profile. Requests outside the preview origin and all methods other than GET/HEAD were blocked. No production requests were allowed.

Browser: Playwright 1.63.0, bundled Chromium 153.0.8010.12, headless Linux; 4 virtual CPUs and 8 GiB memory. No CPU or network throttling. Reported samples were collected after the crawl finished, with no competing crawl traffic. Earlier samples that overlapped the crawl were discarded and remeasured sequentially. Timings include public-network and server variability and are not equivalent to the local fixture benchmark. Repeat this remote protocol in the same environment for the Astro preview comparison.

JavaScript (JS) bytes sum each unique requested script URL plus executable inline scripts parsed from the original HTML. Decoded means UTF-8 script body bytes; gzip means the sum of independently compressed script bodies at level 9, rather than actual wire transfer bytes. JSON-LD structured data and non-executable data/props are excluded. First contentful paint (FCP) is the first visible content; largest contentful paint (LCP) is the largest visible element. Paint values are medians of five samples, observed after network idle, font readiness, and one second of settling. Initial load only; no interaction.

| Path | HTTP status | Samples | Decoded JS bytes | gzip JS bytes | Median FCP (ms) | Median LCP (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | 200 | 5 | 822,338 | 223,864 | 1720.0 | 2324.0 |
| `/ja` | 200 | 5 | 819,250 | 227,373 | 1664.0 | 2264.0 |
| `/rankings` | 200 | 5 | 1,413,333 | 249,652 | 1896.0 | 1896.0 |
| `/ja/rankings` | 200 | 5 | 1,414,210 | 253,004 | 1968.0 | 1968.0 |
| `/rankings/2026/7` | 404 | 5 | 736,313 | 218,107 | 1936.0 | 1936.0 |
| `/ja/rankings/2026/7` | 404 | 5 | 767,395 | 230,432 | 1896.0 | 1896.0 |
| `/react/react` | 200 | 5 | 777,767 | 221,687 | 252.0 | 884.0 |
| `/ja/react/react` | 200 | 5 | 774,704 | 225,198 | 260.0 | 892.0 |
| `/compare` | 200 | 5 | 765,433 | 223,902 | 712.0 | 1296.0 |
| `/ja/compare` | 200 | 5 | 762,058 | 227,383 | 628.0 | 1260.0 |
| `/pulse` | 200 | 5 | 821,651 | 223,767 | 1840.0 | 2256.0 |
| `/ja/pulse` | 200 | 5 | 818,573 | 227,280 | 1908.0 | 2108.0 |
| `/about` | 200 | 5 | 777,482 | 222,201 | 1144.0 | 1144.0 |
| `/ja/about` | 200 | 5 | 776,672 | 226,382 | 1172.0 | 1172.0 |

All five reported samples per path had identical script inventories and sizes, valid paint observations, no path redirects, and no browser script errors. `/rankings/2026/7` and `/ja/rankings/2026/7` returned HTTP 404 in warmup and all initial attempts; the strict original sampler rejected these responses. Those two paths were then remeasured five times with HTTP 404 explicitly allowed. Their table entries describe the rendered error page, not ranking content, and must not be treated as successful ranking-page baselines. The other 12 paths returned HTTP 200.

## Bounded sitemap crawl

Loaded the preview `/sitemap.xml` and its seven locale sitemaps using GET. Their `<loc>` values use the production domain; only the path and query were retained and requested on the preview origin. Redirects were recorded without following them. No HTML links or operational endpoints were crawled. The sitemap index initially timed out after 30 seconds and succeeded on a subsequent GET; this discovery timeout is separate from page results.

From the 80,941 unique locale page entries (11,563 per locale), selected 2,000 distinct page URLs. Selection was deterministic: group by locale and page type, sort groups and paths lexicographically, then round robin across groups, alternating the first and last remaining path within each group, until the cap. This deliberately includes old and recent ranking boundaries. Sitemap discovery used seven concurrent GETs; page crawl used eight, a 45-second per-URL timeout, and no retries. The cap covers page URLs; the index and seven child sitemaps are eight additional discovery URLs. This sample is not a whole-site pass.

| Scope | URLs | HTTP 200 | HTTP 3xx | HTTP 404 | HTTP 5xx | Other HTTP errors | Transport errors/timeouts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| en | 290 | 220 | 0 | 70 | 0 | 0 | 0 |
| ja | 285 | 215 | 0 | 70 | 0 | 0 | 0 |
| zh | 285 | 215 | 0 | 70 | 0 | 0 | 0 |
| zh-TW | 285 | 215 | 0 | 70 | 0 | 0 | 0 |
| ko | 285 | 215 | 0 | 70 | 0 | 0 | 0 |
| es | 285 | 215 | 0 | 70 | 0 | 0 | 0 |
| fr | 285 | 215 | 0 | 70 | 0 | 0 | 0 |
| **Total pages** | 2000 | 1510 | 0 | 490 | 0 | 0 | 0 |
| Sitemap discovery | 8 | 8 | 0 | 0 | 0 | 0 | 0 |

### Page type coverage

Counts below are requested page URLs, including failures. Every page type present in the sitemaps is represented in every locale. Privacy and other non-sitemap routes are outside this sitemap sample.

| Page type | en | ja | zh | zh-TW | ko | es | fr | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| About | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 7 |
| All categories | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 7 |
| Category detail | 38 | 37 | 37 | 37 | 37 | 37 | 37 | 260 |
| Category group index | 7 | 7 | 7 | 7 | 7 | 7 | 7 | 49 |
| Category list, later pages | 38 | 37 | 37 | 37 | 37 | 37 | 37 | 260 |
| Comparison | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 7 |
| Home | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 7 |
| Organization detail | 38 | 37 | 37 | 37 | 37 | 37 | 37 | 260 |
| Organization index, later pages | 38 | 37 | 37 | 37 | 37 | 37 | 37 | 260 |
| Organization index | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 7 |
| Activity pulse | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 7 |
| Monthly ranking | 37 | 37 | 37 | 37 | 37 | 37 | 37 | 259 |
| Weekly ranking | 38 | 37 | 37 | 37 | 37 | 37 | 37 | 260 |
| Yearly ranking | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 84 |
| Rankings index | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 7 |
| Repository detail | 37 | 37 | 37 | 37 | 37 | 37 | 37 | 259 |

### Failure distribution

| Page type | HTTP 404 |
| --- | ---: |
| Yearly ranking | 84 |
| Monthly ranking | 252 |
| Weekly ranking | 154 |

### Failing URLs

490 failed page URLs in the initial crawl. HTTP 404 means not found; HTTP 5xx means a server error. These are observed baseline failures, not attributed to Astro.

| URL | HTTP status / transport error |
| --- | --- |
| https://pre.gitstarclub.com/es/rankings/2015 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/1 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/10 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/11 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/12 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/2 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/3 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/4 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/5 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/6 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/7 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/8 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/9 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/W01 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/W02 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/W03 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/W04 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/W05 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/W06 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/W07 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/W08 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/W09 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/W10 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/W11 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/W12 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/W13 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/W14 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/W15 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/W16 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/W17 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/W18 | 404 |
| https://pre.gitstarclub.com/es/rankings/2015/W19 | 404 |
| https://pre.gitstarclub.com/es/rankings/2016 | 404 |
| https://pre.gitstarclub.com/es/rankings/2016/1 | 404 |
| https://pre.gitstarclub.com/es/rankings/2016/10 | 404 |
| https://pre.gitstarclub.com/es/rankings/2016/11 | 404 |
| https://pre.gitstarclub.com/es/rankings/2016/12 | 404 |
| https://pre.gitstarclub.com/es/rankings/2016/2 | 404 |
| https://pre.gitstarclub.com/es/rankings/2016/3 | 404 |
| https://pre.gitstarclub.com/es/rankings/2016/4 | 404 |
| https://pre.gitstarclub.com/es/rankings/2017 | 404 |
| https://pre.gitstarclub.com/es/rankings/2018 | 404 |
| https://pre.gitstarclub.com/es/rankings/2019 | 404 |
| https://pre.gitstarclub.com/es/rankings/2020 | 404 |
| https://pre.gitstarclub.com/es/rankings/2021 | 404 |
| https://pre.gitstarclub.com/es/rankings/2022 | 404 |
| https://pre.gitstarclub.com/es/rankings/2023 | 404 |
| https://pre.gitstarclub.com/es/rankings/2024 | 404 |
| https://pre.gitstarclub.com/es/rankings/2025 | 404 |
| https://pre.gitstarclub.com/es/rankings/2025/2 | 404 |
| https://pre.gitstarclub.com/es/rankings/2025/3 | 404 |
| https://pre.gitstarclub.com/es/rankings/2025/4 | 404 |
| https://pre.gitstarclub.com/es/rankings/2025/5 | 404 |
| https://pre.gitstarclub.com/es/rankings/2025/6 | 404 |
| https://pre.gitstarclub.com/es/rankings/2025/7 | 404 |
| https://pre.gitstarclub.com/es/rankings/2025/8 | 404 |
| https://pre.gitstarclub.com/es/rankings/2025/9 | 404 |
| https://pre.gitstarclub.com/es/rankings/2026 | 404 |
| https://pre.gitstarclub.com/es/rankings/2026/1 | 404 |
| https://pre.gitstarclub.com/es/rankings/2026/2 | 404 |
| https://pre.gitstarclub.com/es/rankings/2026/3 | 404 |
| https://pre.gitstarclub.com/es/rankings/2026/4 | 404 |
| https://pre.gitstarclub.com/es/rankings/2026/5 | 404 |
| https://pre.gitstarclub.com/es/rankings/2026/6 | 404 |
| https://pre.gitstarclub.com/es/rankings/2026/7 | 404 |
| https://pre.gitstarclub.com/es/rankings/2026/8 | 404 |
| https://pre.gitstarclub.com/es/rankings/2026/9 | 404 |
| https://pre.gitstarclub.com/es/rankings/2026/W40 | 404 |
| https://pre.gitstarclub.com/es/rankings/2026/W41 | 404 |
| https://pre.gitstarclub.com/es/rankings/2026/W42 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/1 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/10 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/11 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/12 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/2 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/3 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/4 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/5 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/6 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/7 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/8 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/9 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/W01 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/W02 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/W03 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/W04 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/W05 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/W06 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/W07 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/W08 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/W09 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/W10 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/W11 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/W12 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/W13 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/W14 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/W15 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/W16 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/W17 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/W18 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2015/W19 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2016 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2016/1 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2016/10 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2016/11 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2016/12 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2016/2 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2016/3 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2016/4 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2017 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2018 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2019 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2020 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2021 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2022 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2023 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2024 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2025 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2025/2 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2025/3 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2025/4 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2025/5 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2025/6 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2025/7 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2025/8 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2025/9 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2026 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2026/1 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2026/2 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2026/3 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2026/4 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2026/5 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2026/6 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2026/7 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2026/8 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2026/9 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2026/W40 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2026/W41 | 404 |
| https://pre.gitstarclub.com/fr/rankings/2026/W42 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/1 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/10 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/11 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/12 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/2 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/3 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/4 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/5 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/6 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/7 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/8 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/9 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/W01 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/W02 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/W03 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/W04 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/W05 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/W06 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/W07 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/W08 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/W09 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/W10 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/W11 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/W12 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/W13 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/W14 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/W15 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/W16 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/W17 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/W18 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2015/W19 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2016 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2016/1 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2016/10 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2016/11 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2016/12 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2016/2 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2016/3 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2016/4 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2017 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2018 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2019 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2020 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2021 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2022 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2023 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2024 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2025 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2025/2 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2025/3 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2025/4 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2025/5 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2025/6 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2025/7 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2025/8 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2025/9 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2026 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2026/1 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2026/2 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2026/3 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2026/4 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2026/5 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2026/6 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2026/7 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2026/8 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2026/9 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2026/W40 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2026/W41 | 404 |
| https://pre.gitstarclub.com/ja/rankings/2026/W42 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/1 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/10 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/11 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/12 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/2 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/3 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/4 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/5 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/6 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/7 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/8 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/9 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/W01 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/W02 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/W03 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/W04 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/W05 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/W06 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/W07 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/W08 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/W09 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/W10 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/W11 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/W12 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/W13 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/W14 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/W15 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/W16 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/W17 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/W18 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2015/W19 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2016 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2016/1 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2016/10 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2016/11 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2016/12 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2016/2 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2016/3 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2016/4 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2017 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2018 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2019 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2020 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2021 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2022 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2023 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2024 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2025 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2025/2 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2025/3 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2025/4 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2025/5 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2025/6 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2025/7 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2025/8 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2025/9 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2026 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2026/1 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2026/2 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2026/3 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2026/4 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2026/5 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2026/6 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2026/7 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2026/8 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2026/9 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2026/W40 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2026/W41 | 404 |
| https://pre.gitstarclub.com/ko/rankings/2026/W42 | 404 |
| https://pre.gitstarclub.com/rankings/2015 | 404 |
| https://pre.gitstarclub.com/rankings/2015/1 | 404 |
| https://pre.gitstarclub.com/rankings/2015/10 | 404 |
| https://pre.gitstarclub.com/rankings/2015/11 | 404 |
| https://pre.gitstarclub.com/rankings/2015/12 | 404 |
| https://pre.gitstarclub.com/rankings/2015/2 | 404 |
| https://pre.gitstarclub.com/rankings/2015/3 | 404 |
| https://pre.gitstarclub.com/rankings/2015/4 | 404 |
| https://pre.gitstarclub.com/rankings/2015/5 | 404 |
| https://pre.gitstarclub.com/rankings/2015/6 | 404 |
| https://pre.gitstarclub.com/rankings/2015/7 | 404 |
| https://pre.gitstarclub.com/rankings/2015/8 | 404 |
| https://pre.gitstarclub.com/rankings/2015/9 | 404 |
| https://pre.gitstarclub.com/rankings/2015/W01 | 404 |
| https://pre.gitstarclub.com/rankings/2015/W02 | 404 |
| https://pre.gitstarclub.com/rankings/2015/W03 | 404 |
| https://pre.gitstarclub.com/rankings/2015/W04 | 404 |
| https://pre.gitstarclub.com/rankings/2015/W05 | 404 |
| https://pre.gitstarclub.com/rankings/2015/W06 | 404 |
| https://pre.gitstarclub.com/rankings/2015/W07 | 404 |
| https://pre.gitstarclub.com/rankings/2015/W08 | 404 |
| https://pre.gitstarclub.com/rankings/2015/W09 | 404 |
| https://pre.gitstarclub.com/rankings/2015/W10 | 404 |
| https://pre.gitstarclub.com/rankings/2015/W11 | 404 |
| https://pre.gitstarclub.com/rankings/2015/W12 | 404 |
| https://pre.gitstarclub.com/rankings/2015/W13 | 404 |
| https://pre.gitstarclub.com/rankings/2015/W14 | 404 |
| https://pre.gitstarclub.com/rankings/2015/W15 | 404 |
| https://pre.gitstarclub.com/rankings/2015/W16 | 404 |
| https://pre.gitstarclub.com/rankings/2015/W17 | 404 |
| https://pre.gitstarclub.com/rankings/2015/W18 | 404 |
| https://pre.gitstarclub.com/rankings/2015/W19 | 404 |
| https://pre.gitstarclub.com/rankings/2016 | 404 |
| https://pre.gitstarclub.com/rankings/2016/1 | 404 |
| https://pre.gitstarclub.com/rankings/2016/10 | 404 |
| https://pre.gitstarclub.com/rankings/2016/11 | 404 |
| https://pre.gitstarclub.com/rankings/2016/12 | 404 |
| https://pre.gitstarclub.com/rankings/2016/2 | 404 |
| https://pre.gitstarclub.com/rankings/2016/3 | 404 |
| https://pre.gitstarclub.com/rankings/2016/4 | 404 |
| https://pre.gitstarclub.com/rankings/2017 | 404 |
| https://pre.gitstarclub.com/rankings/2018 | 404 |
| https://pre.gitstarclub.com/rankings/2019 | 404 |
| https://pre.gitstarclub.com/rankings/2020 | 404 |
| https://pre.gitstarclub.com/rankings/2021 | 404 |
| https://pre.gitstarclub.com/rankings/2022 | 404 |
| https://pre.gitstarclub.com/rankings/2023 | 404 |
| https://pre.gitstarclub.com/rankings/2024 | 404 |
| https://pre.gitstarclub.com/rankings/2025 | 404 |
| https://pre.gitstarclub.com/rankings/2025/2 | 404 |
| https://pre.gitstarclub.com/rankings/2025/3 | 404 |
| https://pre.gitstarclub.com/rankings/2025/4 | 404 |
| https://pre.gitstarclub.com/rankings/2025/5 | 404 |
| https://pre.gitstarclub.com/rankings/2025/6 | 404 |
| https://pre.gitstarclub.com/rankings/2025/7 | 404 |
| https://pre.gitstarclub.com/rankings/2025/8 | 404 |
| https://pre.gitstarclub.com/rankings/2025/9 | 404 |
| https://pre.gitstarclub.com/rankings/2026 | 404 |
| https://pre.gitstarclub.com/rankings/2026/1 | 404 |
| https://pre.gitstarclub.com/rankings/2026/2 | 404 |
| https://pre.gitstarclub.com/rankings/2026/3 | 404 |
| https://pre.gitstarclub.com/rankings/2026/4 | 404 |
| https://pre.gitstarclub.com/rankings/2026/5 | 404 |
| https://pre.gitstarclub.com/rankings/2026/6 | 404 |
| https://pre.gitstarclub.com/rankings/2026/7 | 404 |
| https://pre.gitstarclub.com/rankings/2026/8 | 404 |
| https://pre.gitstarclub.com/rankings/2026/9 | 404 |
| https://pre.gitstarclub.com/rankings/2026/W40 | 404 |
| https://pre.gitstarclub.com/rankings/2026/W41 | 404 |
| https://pre.gitstarclub.com/rankings/2026/W42 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/1 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/10 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/11 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/12 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/2 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/3 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/4 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/5 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/6 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/7 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/8 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/9 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/W01 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/W02 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/W03 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/W04 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/W05 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/W06 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/W07 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/W08 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/W09 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/W10 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/W11 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/W12 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/W13 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/W14 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/W15 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/W16 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/W17 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/W18 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2015/W19 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2016 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2016/1 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2016/10 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2016/11 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2016/12 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2016/2 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2016/3 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2016/4 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2017 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2018 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2019 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2020 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2021 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2022 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2023 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2024 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2025 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2025/2 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2025/3 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2025/4 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2025/5 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2025/6 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2025/7 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2025/8 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2025/9 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2026 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2026/1 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2026/2 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2026/3 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2026/4 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2026/5 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2026/6 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2026/7 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2026/8 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2026/9 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2026/W40 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2026/W41 | 404 |
| https://pre.gitstarclub.com/zh-TW/rankings/2026/W42 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/1 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/10 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/11 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/12 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/2 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/3 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/4 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/5 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/6 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/7 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/8 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/9 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/W01 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/W02 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/W03 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/W04 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/W05 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/W06 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/W07 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/W08 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/W09 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/W10 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/W11 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/W12 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/W13 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/W14 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/W15 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/W16 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/W17 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/W18 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2015/W19 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2016 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2016/1 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2016/10 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2016/11 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2016/12 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2016/2 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2016/3 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2016/4 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2017 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2018 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2019 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2020 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2021 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2022 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2023 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2024 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2025 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2025/2 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2025/3 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2025/4 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2025/5 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2025/6 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2025/7 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2025/8 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2025/9 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2026 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2026/1 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2026/2 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2026/3 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2026/4 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2026/5 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2026/6 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2026/7 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2026/8 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2026/9 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2026/W40 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2026/W41 | 404 |
| https://pre.gitstarclub.com/zh/rankings/2026/W42 | 404 |

## Verification

- Read-only measurement only; no application test command was required or run.
- Report generation checked 14 paths, five valid paint/size samples each (including the two explicitly labeled HTTP 404 pages), stable JavaScript inventories, exactly 2,000 distinct crawl URLs, all seven locales, and all sitemap page types.
- Deployment identity was rechecked after measurement. The Cloudflare rollback version identifier was not queried.
- Temporary measurement scripts, browser profile, and raw samples remain uncommitted under `.kanban-work/751/`. Only this report is committed.
