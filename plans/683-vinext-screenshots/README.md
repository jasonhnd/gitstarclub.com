# Issue 683: vinext host screenshot evidence

Twelve full-page PNGs compare the clean pre baseline ec92c925 (Next 16.4.2)
with the migrated application d821c978 (vinext 1.2.1). Both use React 19.3.1,
Node 24.20.0, Bun 1.4.2, a 1280 x 720 viewport and dark media preference.
[Capture metadata](capture.json) records versions, dimensions and SHA-256 values.
The following static-asset security-header commit changes no page content or CSS.
The exact delivery head is separately rebuilt and verified in the PR body.

Both applications were built with the empty, read-only CI fixture. For runtime
captures, the GET/HEAD-only `web/scripts/local-view-fixture.ts` serves only
`web/scripts/fixtures/views` from loopback, without modifying fixtures or
expanding data coverage. The migrated home shows the literal empty build
snapshot. The baseline English home had regenerated from the sample JSON before
capture, so that pair compares different data states (2039 versus 1667 pixels
high). The Japanese home is empty in both captures. Monthly rankings and the
example repository render the existing sample JSON.
All six routes return 200 in each application. Captures wait for loaded fonts;
the browser reports zero page-script errors. The temporary profile, local
servers, caches and build output all stay in the excluded card directory.

No product layout or copy change is intended. The other five pairs have matching
dimensions; the English ranking and repository pairs also have identical PNG
bytes. The English home pair cannot establish visual parity for equal data.
These images provide review evidence; the owner still performs visual acceptance
before merge.
No deployment or remote refresh is part of this evidence.

| Page | Before | After |
| --- | --- | --- |
| English home | [PNG](before-home-en.png) | [PNG](after-home-en.png) |
| Japanese home | [PNG](before-home-ja.png) | [PNG](after-home-ja.png) |
| English monthly ranking | [PNG](before-ranking-en.png) | [PNG](after-ranking-en.png) |
| Japanese monthly ranking | [PNG](before-ranking-ja.png) | [PNG](after-ranking-ja.png) |
| English repository | [PNG](before-repo-en.png) | [PNG](after-repo-en.png) |
| Japanese repository | [PNG](before-repo-ja.png) | [PNG](after-repo-ja.png) |

Reproduce with the pinned bootstrap, the fixture builds, then a local preview
and read-only sample fixture. Use an isolated card-local browser profile:

```bash
agent-browser --session GSC_0075 open http://127.0.0.1:4176/
agent-browser --session GSC_0075 set viewport 1280 720
agent-browser --session GSC_0075 set media dark
agent-browser --session GSC_0075 eval 'document.fonts.ready.then(() => true)'
agent-browser --session GSC_0075 screenshot --full "$KANBAN_TMP/after-home-en.png"
agent-browser --session GSC_0075 close
```
