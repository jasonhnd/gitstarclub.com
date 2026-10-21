import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { startWorker } from "../../scripts/local-worker";
import { p1FixtureRecords } from "./fixture";
import { getDictionary, LOCALES } from "../../../web/lib/i18n";
import { localizedPath } from "../../../web/lib/i18n/routing";

const worker = await startWorker(p1FixtureRecords());
const results: unknown[] = [];
try {
  const origin = (await worker.ready).origin;
  for (const locale of LOCALES) {
    const t = await getDictionary(locale);
    for (const path of ["/", "/rankings", "/rankings/2026", "/rankings/2026/7", "/rankings/2026/W29"]) {
      const url = origin + localizedPath(locale, path);
      const response = await fetch(url, { headers: { "accept-language": "en" } });
      const body = await response.text();
      assert.equal(response.status, 200, `${url}: ${body.slice(0, 250)}`);
      assert.ok(body.includes("example/repo"), `${url}: populated rank missing`);
      assert.ok(body.includes('type="application/ld+json"'), `${url}: structured facts missing`);
      if (path.endsWith("W29") || path === "/") assert.ok(body.includes(t.common.starHistoryNote), `${url}: provenance missing`);
      if (path === "/" || path === "/rankings") assert.ok(!body.includes("controls."), `${url}: unnecessary P1 browser code`);
      assert.equal((body.match(/<header/g) ?? []).length, 1, `${url}: duplicate chrome`);
      results.push({ path: localizedPath(locale, path), status: response.status, populated: true, provenance: path.endsWith("W29") || path === "/" });
    }
  }
  for (const path of ["/rankings/invalid", "/rankings/2026/13", "/rankings/2026/W54", "/rankings/2025/1", "/de/rankings", "/en/rankings"]) {
    const response = await fetch(origin + path, { redirect: "manual", headers: { "accept-language": "en" } });
    assert.equal(response.status, 404, path);
  }
  for (const path of ["/rankings/2026/opengraph-image", "/rankings/2026/7/opengraph-image", "/rankings/2026/W29/opengraph-image"]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get("content-type")?.startsWith("image/png"), path);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual(Array.from(bytes.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
    console.log(`P1 ranking image: ${path} PNG ${bytes.length} bytes`);
  }
  writeFileSync(resolve(process.env.KANBAN_TMP!, "p1-routes.json"), JSON.stringify({ passed: true, results }, null, 2) + "\n");
  console.log(`P1 Worker: ${results.length} populated route/locale cases passed; invalid and missing periods rejected.`);
} finally { await worker.dispose(); }
