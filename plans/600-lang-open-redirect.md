# Issue 600: close the /api/lang open redirect

## Goal

Stop `GET /api/lang` from redirecting off-site when a locale prefix hides a protocol-relative path. The confirmed case is `lang=en&next=/ja//example.com/path`, which 307s to `https://example.com/path`. After the locale prefix is removed, validate that path again, and redirect only when the final URL origin equals the request origin. Otherwise send the browser to that locale's home. Keep the `/api/lang?lang=…&next=…` contract.

## Scope

- `web/app/api/lang/route.ts`: re-validate with `safeInternalRedirectPath` after `stripLocale`, then require the redirect URL origin to match the request before `NextResponse.redirect`.
- Handler tests in `web/lib/i18n/middleware.test.ts` for every non-default locale prefix, including `zh-TW`: double slash, triple slash, backslash, percent-encoding, and ordinary in-site navigation.
- Contract notes in `docs/API.md`, `docs/TESTING.md`, `docs/I18N.md`, and `docs/UIUX-ROUTE-INVENTORY.md`.

## Out of scope

- Changing `stripLocale` so it also removes the default `en` prefix.
- Middleware cookie redirects, the language switcher URL shape, CSP, CI, wrangler, and storage.
- A production hotfix onto `main`. This branch stays a pull request into `pre`.

## Acceptance

- `next=/ja//example.com/path` with `lang=en` stays on the request origin and lands on `/`. The same payload with another `lang` lands on that locale's home.
- The same holds for `zh`, `zh-TW`, `ko`, `es`, and `fr`, and for triple slashes, backslashes, and percent-encoded slashes or backslashes.
- `lang=fr&next=/rankings` still redirects to `/fr/rankings` and sets `gsc_lang=fr`. Stripping a real locale prefix from an in-site path still works.
- Removing the post-strip `safeInternalRedirectPath` call makes the new handler tests fail.
- The AGENTS.md static job and fixture production build pass in a fresh detached worktree. `bun.lock` is unchanged.
