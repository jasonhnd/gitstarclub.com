import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { startWorker } from "./local-worker";
import { crawlFixtureRecords } from "./crawl-fixture";
import { LOCALES, localizedPath } from "../src/lib/i18n";

// Crawl only the built, locally seeded Worker. No caller-supplied or remote host.
const worker = await startWorker(crawlFixtureRecords());
try {
  const origin = (await worker.ready).origin;
  const pending = ["/", "/sitemap.xml", "/robots.txt", "/manifest.webmanifest", "/opengraph-image", "/search-index"];
  for (const locale of LOCALES) for (const path of ["/", "/rankings", "/categories", "/o", "/compare", "/pulse", "/about", "/privacy", "/example/repo"]) pending.push(localizedPath(locale, path));
  const queued = new Set(pending);
  const seen = new Set<string>();
  const failures: { path: string; status: number }[] = [];
  const results: { path: string; status: number; bytes: number }[] = [];
  function add(value: string, from: string) {
    const url = new URL(value.replaceAll("&amp;", "&"), new URL(from, origin));
    if (![origin, "https://gitstarclub.com"].includes(url.origin)) return;
    url.hash = "";
    if (/^\/(?:api\/(?:cron|workflows)|start|enqueue|preview\/invalidate)(?:\/|$)/.test(url.pathname)) throw new Error(`Unexpected operational link: ${url.pathname}`);
    // Language links are verified as redirects, then their target pages are crawled.
    const key = url.pathname + url.search;
    if (!queued.has(key)) { queued.add(key); pending.push(key); }
  }
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const path = pending[cursor];
    if (seen.has(path)) continue;
    seen.add(path);
    if (seen.size % 1000 === 0) console.log(`Crawl progress: ${seen.size} visited; ${failures.length} errors; ${pending.length - cursor - 1} queued`);
    assert(seen.size <= 60000, "bounded fixture crawl; investigate an unbounded link graph");
    const response = await fetch(new URL(path, origin), { redirect: "manual", headers: { "accept-language": "en" } });
    const body = await response.arrayBuffer();
    results.push({ path, status: response.status, bytes: body.byteLength });
    if (response.status >= 400) { failures.push({ path, status: response.status }); continue; }
    const location = response.headers.get("location");
    if (location) add(location, path);
    const type = response.headers.get("content-type") ?? "";
    if (!/(?:html|xml|css)/.test(type)) continue;
    const text = new TextDecoder().decode(body);
    if (type.includes("xml")) {
      for (const match of text.matchAll(/<loc>([^<]+)<\/loc>/g)) add(match[1], path);
    } else if (type.includes("html")) {
      for (const match of text.matchAll(/\b(?:href|src)="([^"]+)"/g)) if (!/^(?:#|data:|mailto:|tel:|javascript:)/.test(match[1])) add(match[1], path);
      for (const match of text.matchAll(/\b(?:component-url|renderer-url)="([^"]+)"/g)) add(match[1], path);
    } else {
      for (const match of text.matchAll(/url\(["']?([^\s)"']+)["']?\)/g)) if (!match[1].startsWith("data:")) add(match[1], path);
    }
  }
  const summary = { origin: "local-built-Astro-Worker", visited: seen.size, internal404s: failures.filter(({ status }) => status === 404).length, failures, results };
  writeFileSync(resolve(process.env.KANBAN_TMP!, "astro-link-crawl.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`Astro whole-site crawl: ${seen.size} URLs; ${summary.internal404s} internal 404s; ${failures.length} HTTP errors`);
  if (failures.length) console.error(JSON.stringify(failures, null, 2));
  assert.equal(failures.length, 0, "every internal page, redirect and linked asset must resolve");
} finally { await worker.dispose(); }
