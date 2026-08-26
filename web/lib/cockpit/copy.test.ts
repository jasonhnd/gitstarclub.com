import { describe, expect, test } from "bun:test";
import { COPY, FORBIDDEN_GLASS_TERMS } from "./copy";

describe("cockpit glass copy", () => {
  test("visible strings avoid internal jargon", () => {
    const blob = Object.values(COPY).join(" ");
    for (const term of FORBIDDEN_GLASS_TERMS) {
      expect(blob.includes(term), `glass copy must not include ${term}`).toBe(false);
    }
  });
});
