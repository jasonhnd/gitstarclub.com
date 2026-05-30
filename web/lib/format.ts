// Display formatting helpers (UI-only, no data dependency).

export function fmtK(n: number): string {
  return Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function fmtStars(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const MONTH_ABBR = MONTH_NAMES.map((m) => m.slice(0, 3));

/** 'YYYY-MM' or 'YYYY-MM-DD' → { y, m, pretty }. */
export function ymParts(period: string): { y: number; m: number; pretty: string } {
  const [y, m] = period.split("-").map(Number);
  return { y, m, pretty: `${MONTH_ABBR[m - 1]} ${y}` };
}
