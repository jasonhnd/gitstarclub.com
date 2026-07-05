export function initialSearchActiveIndex(count: number): number {
  return count > 0 ? 0 : -1;
}

export function nextSearchActiveIndex(current: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return -1;
  if (direction > 0) return Math.min(current + 1, count - 1);
  return Math.max(current - 1, 0);
}
