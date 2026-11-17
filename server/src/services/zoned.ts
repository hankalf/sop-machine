/**
 * Wall-clock time in the site's time zone. Railway runs in UTC, so shifts, days and
 * "today" are all computed here instead of with the server's local time.
 */

export interface CivilDate {
  y: number;
  m: number;
  d: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function validTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const siteZone = (tz: string) => (validTimeZone(tz) ? tz : 'UTC');

/** Wall-clock fields of an instant in a zone. */
export function wallClock(tz: string, at: Date) {
  const parts = formatter(tz).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour'), mm: get('minute'), ss: get('second') };
}

/** Minutes the zone is ahead of UTC at an instant. */
function offsetMinutes(tz: string, at: Date): number {
  const w = wallClock(tz, at);
  return (Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm, w.ss) - Math.floor(at.getTime() / 1000) * 1000) / 60000;
}

/** The instant a wall-clock time happens in a zone. A time skipped by a DST change lands an hour earlier. */
export function zonedTime(tz: string, date: CivilDate, hh: number, mm: number): Date {
  const guess = Date.UTC(date.y, date.m - 1, date.d, hh, mm);
  const first = offsetMinutes(tz, new Date(guess));
  let t = guess - first * 60000;
  const second = offsetMinutes(tz, new Date(t));
  if (second !== first) t = guess - second * 60000;
  return new Date(t);
}

export function addDays(date: CivilDate, n: number): CivilDate {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export const weekday = (date: CivilDate) => new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
export const isoDate = (date: CivilDate) => `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
export const today = (tz: string, at = new Date()): CivilDate => {
  const w = wallClock(tz, at);
  return { y: w.y, m: w.m, d: w.d };
};
export const parseHm = (s: string): [number, number] => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  return m ? [Math.min(23, Number(m[1])), Math.min(59, Number(m[2]))] : [0, 0];
};
export const minutesOf = (s: string) => {
  const [h, m] = parseHm(s);
  return h * 60 + m;
};

const DAY_FMT = new Map<string, Intl.DateTimeFormat>();
/** "Mon Nov 17" for a civil date. */
export function dayLabel(date: CivilDate): string {
  let f = DAY_FMT.get('x');
  if (!f) DAY_FMT.set('x', (f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })));
  return f.format(new Date(Date.UTC(date.y, date.m - 1, date.d, 12)));
}
