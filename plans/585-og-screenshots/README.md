# Open-graph screenshots for issue 585

Rendered from the committed repository route `web/app/(en)/[locale]/[owner]/opengraph-image.tsx`. Each image is 1200 by 630 PNG.

| File | Commit | Request path | What it shows |
|---|---|---|---|
| `unknown-no-such-owner-no-such-repo-base-2958fc2.png` | `2958fc2` | `no-such-owner/no-such-repo` | Path-labelled repository card. The route paints the URL. |
| `unknown-no-such-owner-no-such-repo-head-6de4e7e.png` | `6de4e7e` | `no-such-owner/no-such-repo` | Site card. The URL is not painted. |
| `known-example-repo-head-6de4e7e.png` | `6de4e7e` | `Example/Repo` | Repository card kept for a known id. The title is the stored name `example/repo`, with 100 stars and TypeScript from `web/scripts/fixtures/views/entity/repo/1.json`. |

The lookup fixture is `web/scripts/fixtures/views/lookup/repos.json`. `fetch` was replaced so it throws. The unknown path did not read an entity. The known path read the fixture entity once.
