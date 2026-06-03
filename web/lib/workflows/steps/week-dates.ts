// Pure ISO-week date math for the canonical week fold (§8.3). All UTC, no I/O.
// Week ids are "YYYY-Www" (zero-padded), produced by the SAME isoWeek() the live cron uses
// (lib/periods.ts), so a folded week id equals the live-overlay week id it replaces.

import { isoWeek } from "@/lib/periods";

/** ISO week id ("YYYY-Www") for a UTC 'YYYY-MM-DD' date — must match lib/cron/live-refresh.ts. */
export function weekIdOf(date: string): string {
  const w = isoWeek(new Date(`${date}T00:00:00.000Z`));
  return `${w.year}-W${String(w.week).padStart(2, "0")}`;
}

/** Monday (ISO week start, 'YYYY-MM-DD' UTC) of the week containing `date`. */
export function isoMonday(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  const day = d.getUTCDay() || 7; // Sun=7
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}

/** Sunday (ISO week end, 'YYYY-MM-DD' UTC) of the week containing `date`. */
export function isoSunday(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + (7 - day));
  return d.toISOString().slice(0, 10);
}

/** Add `n` days to a 'YYYY-MM-DD' UTC date, returning 'YYYY-MM-DD'. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday ('YYYY-MM-DD' UTC) of an ISO week id "YYYY-Www".
 *  ISO 8601: week 1 is the week containing Jan 4 (equivalently, the first Thursday). Inverse of
 *  weekIdOf — round-trips with it (weekIdOf(mondayOfWeekId(w)) === w) across year boundaries. */
export function mondayOfWeekId(weekId: string): string {
  const [yStr, wStr] = weekId.split("-W");
  const year = Number(yStr);
  const week = Number(wStr);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7; // Sun=7
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1)); // Monday of ISO week 1
  week1Monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return week1Monday.toISOString().slice(0, 10);
}

/** Sunday ('YYYY-MM-DD' UTC) of an ISO week id "YYYY-Www". */
export function sundayOfWeekId(weekId: string): string {
  return addDays(mondayOfWeekId(weekId), 6);
}

/** 'YYYY-MM' month bucket of a 'YYYY-MM-DD' date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** Last day ('YYYY-MM-DD') of a 'YYYY-MM' month. */
export function endOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // day 0 of next month = last day
}

/** Distinct 'YYYY-MM' months spanned by [fromDate, throughDate] inclusive (ascending). */
export function monthsBetween(fromDate: string, throughDate: string): string[] {
  const out: string[] = [];
  let m = monthOf(fromDate);
  const last = monthOf(throughDate);
  while (m <= last) {
    out.push(m);
    const [y, mo] = m.split("-").map(Number);
    m = mo >= 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  return out;
}
