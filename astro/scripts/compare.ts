import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export function loopbackOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Comparison requires a loopback origin.");
  return url.origin;
}

export async function compareSites(options: { web: string; astro: string; paths: string[]; scope?: "page" | "shell"; screenshots?: boolean }) {
  const scratch = process.env.KANBAN_TMP;
  if (!scratch) throw new Error("Set KANBAN_TMP for browser profiles, reports and screenshots.");
  const web = loopbackOrigin(options.web);
  const astro = loopbackOrigin(options.astro);
  if (options.paths.some((path) => !path.startsWith("/") || path.startsWith("//"))) throw new Error("Comparison paths must be internal paths.");
  const context = await chromium.launchPersistentContext(resolve(scratch, "parity-browser"), {
    headless: true, viewport: { width: 1440, height: 1000 }, locale: "en-US", serviceWorkers: "block",
  });
  const results: { path: string; viewport: string; differences: string[]; web: unknown; astro: unknown }[] = [];
  try {
    const page = await context.newPage();
    const normalizeOrigin = (value: string) => value.replaceAll(web, "http://local.invalid").replaceAll(astro, "http://local.invalid");
    for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const path of options.paths) {
        const snapshots: unknown[] = [];
        for (const [host, origin] of [["web", web], ["astro", astro]]) {
          const response = await context.request.get(`${origin}${path}`, { maxRedirects: 0, headers: { accept: "text/html", "accept-language": "en" } });
          const status = response.status();
          const location = response.headers().location;
          if (status >= 300 && status < 400) {
            snapshots.push({ status, location: location ? normalizeOrigin(new URL(location, origin).href) : null });
          } else if (!response.headers()["content-type"]?.includes("text/html")) {
            snapshots.push({ status, body: normalizeOrigin(await response.text()) });
          } else {
            await page.goto(`${origin}${path}`, { waitUntil: "networkidle" });
            await page.evaluate(() => document.fonts.ready);
            const fields = await page.evaluate((scope) => {
              const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
              const sortedJson = (value: unknown): unknown => Array.isArray(value) ? value.map(sortedJson) : value && typeof value === "object"
                ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortedJson(item)])) : value;
              const meta = Array.from(document.head.querySelectorAll<HTMLMetaElement>("meta[name],meta[property]"))
                .map((element) => [element.name || element.getAttribute("property"), element.media || "", element.content]).sort();
              const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null;
              const hreflang = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="alternate"][hreflang]')).map((element) => [element.hreflang, element.href]).sort();
              const jsonld = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((element) => sortedJson(JSON.parse(element.textContent ?? "null")));
              const text = scope === "shell" ? Array.from(document.querySelectorAll<HTMLElement>("header,footer")).map((element) => normalize(element.innerText)) : [normalize(document.body.innerText)];
              return { lang: document.documentElement.lang, text, title: document.title, meta, canonical, hreflang, jsonld };
            }, options.scope ?? "page");
            snapshots.push(JSON.parse(normalizeOrigin(JSON.stringify({ status, ...fields }))));
            if (options.screenshots) {
              const directory = resolve(scratch, "screenshots"); mkdirSync(directory, { recursive: true });
              const slug = path.replace(/[^a-zA-Z0-9-]+/g, "_") || "home";
              if (options.scope === "shell") {
                for (const region of ["header", "footer"]) await page.locator(region).screenshot({ path: resolve(directory, `${host}-${viewport.name}-${slug}-${region}.png`), animations: "disabled" });
              } else await page.screenshot({ path: resolve(directory, `${host}-${viewport.name}-${slug}.png`), fullPage: true, animations: "disabled" });
            }
          }
          await response.dispose();
        }
        const old = snapshots[0] as Record<string, unknown>;
        const next = snapshots[1] as Record<string, unknown>;
        const differences = [...new Set([...Object.keys(old), ...Object.keys(next)])].filter((key) => JSON.stringify(old[key]) !== JSON.stringify(next[key]));
        results.push({ path, viewport: viewport.name, differences, web: old, astro: next });
      }
    }
  } finally { await context.close(); }
  const report = { scope: options.scope ?? "page", web, astro, passed: results.every((result) => result.differences.length === 0), results };
  const destination = resolve(scratch, "parity-report.json");
  writeFileSync(destination, JSON.stringify(report, null, 2) + "\n");
  for (const item of results) console.log(`${item.differences.length ? "DIFF" : "PASS"} ${item.viewport} ${item.path}${item.differences.length ? `: ${item.differences.join(", ")}` : ""}`);
  console.log(`Comparison report: ${destination}`);
  return report;
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  const web = value("--web"), astro = value("--astro");
  if (!web || !astro) throw new Error("Use --web <loopback-origin> --astro <loopback-origin> --paths <json-array-file> [--scope shell] [--screenshots].");
  const pathFile = resolve(value("--paths") ?? "scripts/shell-paths.json");
  const paths: unknown = JSON.parse(readFileSync(pathFile, "utf8"));
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string")) throw new Error("Path file must contain a JSON array of strings.");
  const scope = value("--scope") ?? "page";
  if (scope !== "page" && scope !== "shell") throw new Error("Scope must be page or shell.");
  const report = await compareSites({ web, astro, paths, scope, screenshots: args.includes("--screenshots") });
  process.exitCode = report.passed ? 0 : 1;
}
