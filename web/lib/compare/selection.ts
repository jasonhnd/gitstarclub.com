import { MAX_COMPARE } from "./constants";

export function nextCompareSelection(
  current: ReadonlySet<string>,
  fullName: string,
  max = MAX_COMPARE,
): Set<string> {
  const next = new Set(current);
  if (next.has(fullName)) {
    next.delete(fullName);
    return next;
  }
  if (next.size < max) next.add(fullName);
  return next;
}
