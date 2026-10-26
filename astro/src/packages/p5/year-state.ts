export function pulseYearRows<T>(unavailable: boolean, rows: T[]): T[] {
  return unavailable ? [] : rows;
}
