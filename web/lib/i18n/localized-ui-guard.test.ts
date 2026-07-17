import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const localizedDirectory = join(import.meta.dir, "../../app/_localized");

describe("localized reader-visible copy guard", () => {
  test("only keeps reviewed, typed per-locale maps as top-level copy dictionaries under app/_localized", () => {
    const reviewedLocaleMaps = new Set(["categories.tsx:DIMENSION_LABELS", "detail-copy.ts:TEXT"]);
    const violations = readdirSync(localizedDirectory)
      .filter((file) => /\.tsx?$/.test(file))
      .flatMap((file) => {
        const source = readFileSync(join(localizedDirectory, file), "utf8");
        return [...source.matchAll(/^const\s+([A-Z][A-Z0-9_]*)\b([^=\n]*)=\s*\{/gm)].flatMap((match) => {
          const id = `${file}:${match[1]}`;
          const isReviewedTypedLocaleMap = reviewedLocaleMaps.has(id) && /:\s*Record<Locale\s*,/.test(match[2]);
          return isReviewedTypedLocaleMap ? [] : [`${file}:${lineNumber(source, match.index)} ${match[1]}`];
        });
      });

    expect(violations).toEqual([]);
  });

  test("keeps known English-only reader phrases out of localized page implementations", () => {
    const forbidden = ["Aggregate tracked stars", "Citable repository profile", "Permanent archive", 'aria-label="Ranking period"'];
    const violations = readdirSync(localizedDirectory)
      .filter((file) => /\.tsx?$/.test(file))
      .flatMap((file) => {
        const source = readFileSync(join(localizedDirectory, file), "utf8");
        return forbidden.filter((phrase) => source.includes(phrase)).map((phrase) => `${file}: ${phrase}`);
      });

    expect(violations).toEqual([]);
  });
});

function lineNumber(source: string, index = 0): number {
  return source.slice(0, index).split("\n").length;
}
