/**
 * Text limits in the data contracts are measured in Unicode code points.
 *
 * JavaScript's String#slice and String#length operate on UTF-16 code units,
 * which can split supplementary-plane characters. This helper also replaces
 * historical unpaired surrogates with U+FFFD so every returned string is a
 * sequence of Unicode scalar values and can be emitted as strict JSON.
 */
export function truncateUnicodeText(value: string, maxCodePoints: number): string {
  if (!Number.isSafeInteger(maxCodePoints) || maxCodePoints < 0) {
    throw new RangeError("maxCodePoints must be a non-negative safe integer");
  }

  let result = "";
  let codePoints = 0;

  for (let index = 0; index < value.length && codePoints < maxCodePoints; index += 1) {
    const current = value.charCodeAt(index);

    if (isHighSurrogate(current)) {
      const next = value.charCodeAt(index + 1);
      if (isLowSurrogate(next)) {
        result += value[index] + value[index + 1];
        index += 1;
      } else {
        result += "\uFFFD";
      }
    } else if (isLowSurrogate(current)) {
      result += "\uFFFD";
    } else {
      result += value[index];
    }

    codePoints += 1;
  }

  return result;
}

export function unicodeCodePointLength(value: string): number {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (isHighSurrogate(value.charCodeAt(index)) && isLowSurrogate(value.charCodeAt(index + 1))) {
      index += 1;
    }
    length += 1;
  }
  return length;
}

export function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index);
    if (isHighSurrogate(current)) {
      if (!isLowSurrogate(value.charCodeAt(index + 1))) return false;
      index += 1;
    } else if (isLowSurrogate(current)) {
      return false;
    }
  }
  return true;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}
