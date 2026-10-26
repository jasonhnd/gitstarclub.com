import { expect, test } from "bun:test";
import { startWorker } from "../scripts/local-worker";
import { observationCases, observationFixture } from "../tests/p1/observation-fixture";
import { getDictionary, LOCALES } from "../../web/lib/i18n";
import { dateLabel } from "../../web/lib/format";
import { localizedPath } from "../../web/lib/i18n/routing";

for (const archived of [false, true]) {
  for (const scenario of observationCases) {
    test(`${archived ? "archived heatmap" : "live daily totals"}: ${scenario.name} renders coverage on home, Pulse, week and month`, async () => {
      const worker = await startWorker(observationFixture(scenario, archived));
      try {
        const origin = (await worker.ready).origin;
        for (const locale of LOCALES) {
          const t = await getDictionary(locale);
          const expectedLine = scenario.expected ? t.pulse.observedSince.replace("{date}", dateLabel(locale, scenario.expected, "long")) : null;
          const noticePrefix = t.pulse.observedSince.split("{date}")[0];
          for (const path of ["/", "/pulse", `/rankings/2026/${Number(scenario.month.slice(-2))}`, `/rankings/2026/${scenario.week.slice(-3)}`]) {
            const url = origin + localizedPath(locale, path);
            const response = await fetch(url, { headers: { "accept-language": "en" } });
            const html = await response.text();
            expect(response.status, url).toBe(200);
            const paragraphs = [...html.matchAll(/<p\b[^>]*>([^<]*)<\/p>/g)].map((match) => match[1]);
            const lines = paragraphs.filter((text) => text.startsWith(noticePrefix));
            const pulse = path === "/" || path === "/pulse";
            const week = path.includes("/W");
            const count = !expectedLine ? 0 : archived ? week ? 0 : 1 : pulse ? 2 : 1;
            expect(lines, url).toEqual(Array(count).fill(expectedLine));
            if (!pulse && count > 0) {
              const rankingEnd = html.indexOf('</section>', html.indexOf('id="complete-ranking"')) + '</section>'.length;
              expect(html.slice(rankingEnd), url).toStartWith(`<p class="mt-3 text-sm leading-relaxed text-on-surface-variant">${expectedLine}</p>`);
            }
            if (pulse) {
              // Each localized line belongs below its own populated weekly/monthly list.
              const sections = [...html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/g)].map((match) => match[1]);
              for (const [heading, visible] of [[t.week.top, !!expectedLine && !archived], [t.pulse.surging, !!expectedLine]] as const) {
                const section = sections.find((body) => body.includes(`>${heading}</h2>`));
                expect(section, `${url}: ${heading}`).toBeDefined();
                expect(section).toContain("example/repo");
                expect(section!.includes(expectedLine ?? noticePrefix), `${url}: ${heading}`).toBe(visible);
                if (visible) expect(section!.lastIndexOf(expectedLine!)).toBeGreaterThan(section!.lastIndexOf("</table>"));
              }
            }
          }
        }
      } finally { await worker.dispose(); }
    }, 30_000);
  }
}
