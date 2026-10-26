import { expect, test } from "bun:test";
import { startWorker } from "../../scripts/local-worker";
import { homeYearFixture } from "./year-fixture";
import { getDictionary } from "../../../web/lib/i18n";
import { localizedPath } from "../../../web/lib/i18n/routing";
import { fmtStars } from "../../../web/lib/format";

for (const state of ["fallback", "unavailable", "populated"] as const) {
  test(`home and Pulse year panels and leaders: ${state}, en and ja`, async () => {
    const worker = await startWorker(homeYearFixture(state));
    try {
      const origin = (await worker.ready).origin;
      for (const locale of ["en", "ja"] as const) {
        const t = await getDictionary(locale);
        for (const path of ["/", "/pulse"]) {
          const response = await fetch(origin + localizedPath(locale, path), { headers: { "accept-language": "en" } });
          expect(response.status).toBe(200);
          const html = (await response.text()).replace(/<!--[\s\S]*?-->/g, "");
          const heading = html.indexOf(`${t.year.top} `);
          expect(heading).toBeGreaterThan(-1);
          const yearPanel = html.slice(heading, html.indexOf("</section>", heading));
          const label = html.indexOf(`>${t.year.label}</span>`, heading);
          expect(label).toBeGreaterThan(-1);
          const yearLeader = html.slice(label, html.indexOf("</a>", label));
          for (const placement of [yearPanel, yearLeader]) {
            if (state === "populated") {
              expect(placement).toContain("example/repo");
              expect(placement).toContain(fmtStars(1782, locale));
              expect(placement).not.toContain(t.pulse.noYearlyDataYet);
            } else {
              expect(placement).toContain(t.pulse.noYearlyDataYet);
              expect(placement).not.toContain("example/repo");
              expect(placement).not.toContain(fmtStars(1782, locale));
              expect(placement).not.toContain(locale === "ja" ? "2026年7月17日" : "July 17, 2026");
            }
          }
          // The month panel and leader must retain this legitimate non-year gain.
          const monthHeading = html.indexOf(t.pulse.surging);
          const monthPanel = html.slice(monthHeading, html.indexOf("</section>", monthHeading));
          expect(monthPanel).toContain(fmtStars(1782, locale));
        }
      }
    } finally {
      await worker.dispose();
    }
  }, 30000);
}
