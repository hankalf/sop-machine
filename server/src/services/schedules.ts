import { WEEKDAYS } from '../../../shared/defaults';
import type { Occurrence, OccurrenceStatus, Schedule, ScheduleBoard, ScheduleFrequency } from '../../../shared/types';
import { db } from '../db';
import { badRequest, newId, notFound, nowIso } from '../util';
import { getSettings } from './settings';
import { addDays, dayLabel, isoDate, minutesOf, parseHm, siteZone, today, validTimeZone, weekday, wallClock, zonedTime, type CivilDate } from './zoned';

interface ScheduleRow {
  id: string;
  sop_id: string;
  station_ids: string;
  frequency: ScheduleFrequency;
  days: string;
  shift_ids: string;
  active: number;
  created_at: string;
  sop_number: string;
  sop_title: string;
}

const SELECT = 'SELECT sc.*, s.number AS sop_number, s.title AS sop_title FROM schedules sc JOIN sops s ON s.id = sc.sop_id';

const toSchedule = (r: ScheduleRow): Schedule => ({
  id: r.id,
  sopId: r.sop_id,
  sopNumber: r.sop_number,
  sopTitle: r.sop_title,
  stationIds: JSON.parse(r.station_ids),
  frequency: r.frequency,
  days: JSON.parse(r.days),
  shiftIds: JSON.parse(r.shift_ids),
  active: !!r.active,
  createdAt: r.created_at,
});

export function listSchedules(): Schedule[] {
  return (db.prepare(`${SELECT} ORDER BY s.number`).all() as ScheduleRow[]).map(toSchedule);
}

export function saveSchedule(id: string | null, input: Omit<Schedule, 'id' | 'sopNumber' | 'sopTitle' | 'createdAt'>, userId: string): Schedule {
  const sop = db.prepare("SELECT content FROM sops WHERE id = ?").get(input.sopId) as { content: string } | undefined;
  if (!sop) throw notFound('SOP not found');
  if (!JSON.parse(sop.content).checklist?.enabled) throw badRequest('Turn on checklist mode for this SOP first');
  const days = [...new Set(input.days.filter((d) => d >= 0 && d <= 6))].sort();
  if ((input.frequency === 'daily' || input.frequency === 'shift') && !days.length) throw badRequest('Pick at least one day');
  const now = nowIso();
  const sid = id ?? newId();
  if (id) {
    const res = db
      .prepare('UPDATE schedules SET sop_id = ?, station_ids = ?, frequency = ?, days = ?, shift_ids = ?, active = ?, updated_at = ? WHERE id = ?')
      .run(input.sopId, JSON.stringify(input.stationIds), input.frequency, JSON.stringify(days), JSON.stringify(input.shiftIds), input.active ? 1 : 0, now, id);
    if (!res.changes) throw notFound('Schedule not found');
  } else {
    db.prepare(
      'INSERT INTO schedules (id, sop_id, station_ids, frequency, days, shift_ids, active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(sid, input.sopId, JSON.stringify(input.stationIds), input.frequency, JSON.stringify(days), JSON.stringify(input.shiftIds), input.active ? 1 : 0, userId, now, now);
  }
  return toSchedule(db.prepare(`${SELECT} WHERE sc.id = ?`).get(sid) as ScheduleRow);
}

export function deleteSchedule(id: string) {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

interface Period {
  start: Date;
  end: Date;
  label: string;
  day: string;
}

/** Every period of a schedule that overlaps [from, to], in the site's time zone. */
function periods(sc: Schedule, tz: string, from: Date, to: Date): Period[] {
  const shifts = getSettings().schedule.shifts;
  const out: Period[] = [];
  const first = addDays(today(tz, from), -1);
  const last = addDays(today(tz, to), 1);
  const push = (start: Date, end: Date, label: string, day: CivilDate) => {
    if (end > from && start <= to) out.push({ start, end, label, day: isoDate(day) });
  };
  if (sc.frequency === 'daily' || sc.frequency === 'shift') {
    for (let d = first; isoDate(d) <= isoDate(last); d = addDays(d, 1)) {
      if (!sc.days.includes(weekday(d))) continue;
      if (sc.frequency === 'daily') {
        push(zonedTime(tz, d, 0, 0), zonedTime(tz, addDays(d, 1), 0, 0), dayLabel(d), d);
        continue;
      }
      for (const sh of shifts) {
        if (sc.shiftIds.length && !sc.shiftIds.includes(sh.id)) continue;
        const [sh1, sm1] = parseHm(sh.start);
        const [eh, em] = parseHm(sh.end);
        const overnight = minutesOf(sh.end) <= minutesOf(sh.start);
        push(zonedTime(tz, d, sh1, sm1), zonedTime(tz, overnight ? addDays(d, 1) : d, eh, em), `${dayLabel(d)} · ${sh.name}`, d);
      }
    }
  } else if (sc.frequency === 'weekly') {
    // Weeks run Monday to Sunday.
    let d = addDays(first, -((weekday(first) + 6) % 7));
    for (; isoDate(d) <= isoDate(last); d = addDays(d, 7)) push(zonedTime(tz, d, 0, 0), zonedTime(tz, addDays(d, 7), 0, 0), `Week of ${dayLabel(d)}`, d);
  } else {
    let d: CivilDate = { y: first.y, m: first.m, d: 1 };
    while (isoDate(d) <= isoDate(last)) {
      const next: CivilDate = d.m === 12 ? { y: d.y + 1, m: 1, d: 1 } : { y: d.y, m: d.m + 1, d: 1 };
      const name = new Date(Date.UTC(d.y, d.m - 1, 15)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      push(zonedTime(tz, d, 0, 0), zonedTime(tz, next, 0, 0), name, d);
      d = next;
    }
  }
  return out;
}

interface RunLite {
  id: string;
  sop_id: string;
  station_id: string | null;
  status: string;
  fail_count: number;
  performer_name: string;
  started_at: string;
  completed_at: string | null;
}

function stationNames(): Map<string, string> {
  return new Map((db.prepare('SELECT id, name FROM stations').all() as { id: string; name: string }[]).map((s) => [s.id, s.name]));
}

/** Expected checklists between two instants, with what actually happened. */
export function occurrences(from: Date, to: Date, opts: { scheduleId?: string; stationId?: string; sopId?: string } = {}): Occurrence[] {
  const tz = siteZone(getSettings().schedule.timezone);
  const now = new Date();
  const scheds = listSchedules().filter((s) => s.active && (!opts.scheduleId || s.id === opts.scheduleId) && (!opts.sopId || s.sopId === opts.sopId));
  if (!scheds.length) return [];
  const names = stationNames();
  const runs = db
    .prepare(`SELECT id, sop_id, station_id, status, fail_count, performer_name, started_at, completed_at FROM checklist_runs WHERE started_at >= ? AND started_at < ? AND sop_id IN (${scheds.map(() => '?').join(',')})`)
    .all(new Date(from.getTime() - 48 * 3600e3).toISOString(), to.toISOString(), ...scheds.map((s) => s.sopId)) as RunLite[];
  const out: Occurrence[] = [];
  for (const sc of scheds) {
    const created = new Date(sc.createdAt);
    const where = sc.stationIds.length ? sc.stationIds.filter((id) => names.has(id)) : [null];
    for (const p of periods(sc, tz, from, to)) {
      if (p.end <= created) continue;
      for (const stationId of where) {
        if (opts.stationId && stationId !== opts.stationId) continue;
        const inWindow = runs.filter(
          (r) => r.sop_id === sc.sopId && (stationId === null || r.station_id === stationId) && new Date(r.started_at) >= p.start && new Date(r.started_at) < p.end,
        );
        const done = inWindow.filter((r) => r.status === 'completed').sort((a, b) => b.completed_at!.localeCompare(a.completed_at!))[0];
        const active = inWindow.find((r) => r.status !== 'completed');
        let status: OccurrenceStatus;
        if (done) status = done.fail_count > 0 ? 'failed' : 'done';
        else if (p.end <= now) {
          // A schedule created part-way through a period does not count that period as missed.
          if (p.start < created) continue;
          status = 'missed';
        } else status = p.start <= now ? 'due' : 'upcoming';
        const run = done ?? active ?? null;
        out.push({
          scheduleId: sc.id,
          sopId: sc.sopId,
          sopNumber: sc.sopNumber,
          sopTitle: sc.sopTitle,
          stationId,
          stationName: stationId ? (names.get(stationId) ?? null) : null,
          start: p.start.toISOString(),
          end: p.end.toISOString(),
          label: p.label,
          day: p.day,
          status,
          runId: run?.id ?? null,
          performer: run?.performer_name ?? null,
          completedAt: done?.completed_at ?? null,
        });
      }
    }
  }
  return out.sort((a, b) => b.start.localeCompare(a.start) || (a.stationName ?? '').localeCompare(b.stationName ?? ''));
}

export function scheduleBoard(days = 7): ScheduleBoard {
  const s = getSettings();
  const now = new Date();
  const from = new Date(now.getTime() - days * 86400e3);
  const all = occurrences(from, now);
  const current = all.filter((o) => new Date(o.start) <= now && new Date(o.end) > now);
  const history = all.filter((o) => new Date(o.end) <= now);
  const done = history.filter((o) => o.status === 'done').length;
  const failed = history.filter((o) => o.status === 'failed').length;
  const missed = history.filter((o) => o.status === 'missed').length;
  return {
    timezone: siteZone(s.schedule.timezone),
    timezoneSet: validTimeZone(s.schedule.timezone),
    now: current,
    history: history.slice(0, 300),
    stats: { done, failed, missed, compliancePct: done + failed + missed ? Math.round(((done + failed) / (done + failed + missed)) * 100) : null, dueNow: current.filter((o) => o.status === 'due').length },
  };
}

/** Whether a scheduled checklist is due right now at a station (for the station page). */
export function dueAtStation(sopId: string, stationId: string): 'due' | 'done' | null {
  const now = new Date();
  const cur = occurrences(new Date(now.getTime() - 1000), now, { sopId, stationId }).filter((o) => new Date(o.start) <= now && new Date(o.end) > now);
  if (!cur.length) return null;
  return cur.some((o) => o.status === 'due') ? 'due' : 'done';
}

export function describeSchedule(sc: Pick<Schedule, 'frequency' | 'days' | 'shiftIds'>): string {
  const shifts = getSettings().schedule.shifts;
  const days = sc.days.length === 7 ? 'every day' : sc.days.length === 5 && [1, 2, 3, 4, 5].every((d) => sc.days.includes(d)) ? 'weekdays' : sc.days.map((d) => WEEKDAYS[d]).join(', ');
  if (sc.frequency === 'shift') {
    const names = sc.shiftIds.length ? shifts.filter((s) => sc.shiftIds.includes(s.id)).map((s) => s.name).join(', ') : 'every shift';
    return `${names}, ${days}`;
  }
  if (sc.frequency === 'daily') return `Once a day, ${days}`;
  return sc.frequency === 'weekly' ? 'Once a week' : 'Once a month';
}

export const localNowLabel = () => {
  const tz = siteZone(getSettings().schedule.timezone);
  const w = wallClock(tz, new Date());
  return `${String(w.hh).padStart(2, '0')}:${String(w.mm).padStart(2, '0')} ${tz}`;
};
