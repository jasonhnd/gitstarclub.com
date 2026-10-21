import { startWorker } from "../../scripts/local-worker";
import { categoryFixture } from "./fixture";
import { LOCALES, localizedPath, toHreflang } from "../../src/lib/i18n";
import { CATEGORY_DIMENSIONS } from "../../../web/lib/categories/rules";
import { strict as assert } from "node:assert";

export async function verifyCategoryRoutes(records = categoryFixture()) {
  const worker = await startWorker(records);
  let checked = 0;
  try {
    const origin = (await worker.ready).origin;
    const get = (path: string) => fetch(`${origin}${path}`, { redirect: "manual", headers: { "accept-language": "en" } });
    for (const locale of LOCALES) {
      const paths = ["/categories", ...CATEGORY_DIMENSIONS.map((dimension) => `/categories/${dimension}`), "/categories/language/typescript", "/categories/language/typescript/page/2", "/categories/language/python"];
      for (const path of paths) {
        const url = localizedPath(locale, path);
        const response = await get(url);
        const html = await response.text();
        assert.equal(response.status, 200, url);
        assert.ok(html.includes(`<html lang="${toHreflang(locale)}"`), url);
        assert.equal((html.match(/<main /g) ?? []).length, 1, url);
        assert.equal((html.match(/<header /g) ?? []).length, 1, url);
        assert.ok(html.includes('type="application/ld+json"'), url);
        assert.ok(!html.includes("Body.tsx") && !html.includes("client:only"), url);
        checked++;
      }
      for (const path of ["/categories/no-such-dimension", "/categories/language/no-such-category", "/categories/language/unknown", "/categories/language/typescript/page/0", "/categories/language/typescript/page/02", "/categories/language/typescript/page/3"]) {
        const response = await get(localizedPath(locale, path));
        assert.equal(response.status, 404, `${locale} ${path}`);
        await response.text(); checked++;
      }
      const response = await get(localizedPath(locale, "/categories/language/typescript/page/1"));
      assert.equal(response.status, 308);
      assert.equal(new URL(response.headers.get("location")!, origin).pathname, localizedPath(locale, "/categories/language/typescript"));
      await response.text(); checked++;
    }
    console.log(`Category Worker route checks: ${checked} passed (seven locales; index, seven dimensions, detail, pagination, empty, 404 and 308).`);
    return checked;
  } finally { await worker.dispose(); }
}

if (import.meta.main) await verifyCategoryRoutes();
