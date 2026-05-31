// UTC period helpers for live pulse/ranking routes.

export const FIRST_YEAR = 2015;

export function currentUtcPeriods(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const week = isoWeek(now);

  return {
    year,
    month,
    monthPeriod: `${year}-${String(month).padStart(2, "0")}`,
    week,
    weekPeriod: `${week.year}-W${String(week.week).padStart(2, "0")}`,
  };
}

export function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}
