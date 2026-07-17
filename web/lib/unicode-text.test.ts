import { describe, expect, test } from "bun:test";
import {
  isWellFormedUnicode,
  truncateUnicodeText,
  unicodeCodePointLength,
} from "./unicode-text";

describe("truncateUnicodeText", () => {
  test("measures limits in code points without splitting supplementary characters", () => {
    const input = `${"a".repeat(95)}🦍tail`;
    const result = truncateUnicodeText(input, 96);

    expect(result).toBe(`${"a".repeat(95)}🦍`);
    expect(unicodeCodePointLength(result)).toBe(96);
    expect(result.length).toBe(97);
    expect(isWellFormedUnicode(result)).toBe(true);
  });

  test("keeps combining marks and ZWJ sequences well formed under the code-point contract", () => {
    const input = `e\u0301👩‍💻done`;

    expect(truncateUnicodeText(input, 2)).toBe("e\u0301");
    expect(truncateUnicodeText(input, 5)).toBe("e\u0301👩‍💻");
    expect(isWellFormedUnicode(truncateUnicodeText(input, 4))).toBe(true);
  });

  test("normalizes pre-existing unpaired surrogates", () => {
    const malformed = `before\uD83Eafter\uDC00`;
    const result = truncateUnicodeText(malformed, 100);

    expect(result).toBe("before�after�");
    expect(isWellFormedUnicode(malformed)).toBe(false);
    expect(isWellFormedUnicode(result)).toBe(true);
  });

  test("supports zero and rejects invalid limits", () => {
    expect(truncateUnicodeText("text", 0)).toBe("");
    expect(() => truncateUnicodeText("text", -1)).toThrow(RangeError);
    expect(() => truncateUnicodeText("text", 1.5)).toThrow(RangeError);
  });
});
