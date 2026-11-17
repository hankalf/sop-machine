import { isRequiredFor } from '../../../shared/defaults';
import type { CheckItemResult, DashboardData, Sop } from '../../../shared/types';
import { db } from '../db';
import { siteToday } from './actions';
import { scheduleBoard } from './schedules';
import { getSettings } from './settings';
import { getPublishedSop } from './sops';
import { trainingMatrix } from './training';
import { addDays, isoDate, siteZone, today, wallClock } from './zoned';

/** Numbers for the dashboard, over the last `days` days. */
export function dashboard(days: number): DashboardData {
  const tz = siteZone(getSettings().schedule.timezone);
  const since = new Date(Date.now() - days * 86400e3).toISOString();
  const todayIso = siteToday();
  const soonIso = isoDate(addDays(today(tz), 30));

  // ---- Library ----
  const lib = db
    .prepare(
      `SELECT COUNT(*) AS total,
        SUM(status = 'approved') AS approved, SUM(status = 'draft') AS drafts, SUM(status = 'review') AS review,
        SUM(status = 'approved' AND review_date IS NOT NULL AND review_date >= ? AND review_date <= ?) AS due,
        SUM(status = 'approved' AND review_date IS NOT NULL AND review_date < ?) AS overdue
       FROM sops WHERE status != 'archived'`,
    )
    .get(todayIso, soonIso, todayIso) as Record<string, number | null>;

  // ---- Training: required sign-offs per person, by team ----
  // Built from the same matrix as the Training page, so the two always agree.
  const published = (db.prepare("SELECT id FROM sops WHERE published_revision_id IS NOT NULL AND status != 'archived'").all() as { id: string }[])
    .map((r) => getPublishedSop(r.id))
    .filter((s): s is Sop => !!s);
  const matrix = trainingMatrix();
  const teamById = new Map(matrix.teams.map((t) => [t.id, t]));
  const byTeam = new Map<string | null, { members: number; current: number; required: number }>();
  let needResign = 0;
  for (const p of matrix.people) {
    const team = p.teamId ? (teamById.get(p.teamId) ?? null) : null;
    const t = byTeam.get(team?.id ?? null) ?? { members: 0, current: 0, required: 0 };
    t.members++;
    for (const s of matrix.sops) {
      if (!isRequiredFor(team, s)) continue;
      t.required++;
      const c = matrix.cells[p.key]?.[s.id];
      if (c?.current) t.current++;
      else if (c) needResign++;
    }
    byTeam.set(team?.id ?? null, t);
  }
  // Teams with nobody on them yet still show, so an empty team is visible.
  for (const t of matrix.teams) if (!byTeam.has(t.id)) byTeam.set(t.id, { members: 0, current: 0, required: 0 });
  const teamRows = [...byTeam.entries()]
    .map(([id, t]) => ({ id, name: id ? (teamById.get(id)?.name ?? 'Team') : 'No team', ...t, pct: t.required ? Math.round((t.current / t.required) * 100) : null }))
    .sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : a.name.localeCompare(b.name)));
  const reqTotal = teamRows.reduce((n, t) => n + t.required, 0);
  const curTotal = teamRows.reduce((n, t) => n + t.current, 0);

  // ---- Quiz: share of people who passed on their first try ----
  const attempts = db.prepare('SELECT sop_id, version, person_key, passed FROM quiz_attempts WHERE created_at >= ? ORDER BY created_at ASC').all(since) as {
    sop_id: string;
    version: string;
    person_key: string;
    passed: number;
  }[];
  const firstTry = new Map<string, Map<string, boolean>>();
  for (const a of attempts) {
    const m = firstTry.get(a.sop_id) ?? new Map<string, boolean>();
    const k = `${a.person_key}|${a.version}`;
    if (!m.has(k)) m.set(k, !!a.passed);
    firstTry.set(a.sop_id, m);
  }
  const sopInfo = (id: string) => db.prepare('SELECT number, title FROM sops WHERE id = ?').get(id) as { number: string; title: string } | undefined;
  const quiz = [...firstTry.entries()]
    .map(([sopId, m]) => {
      const info = sopInfo(sopId);
      const passed = [...m.values()].filter(Boolean).length;
      return info ? { sopId, number: info.number, title: info.title, people: m.size, firstTryPct: Math.round((passed / m.size) * 100) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => a.firstTryPct - b.firstTryPct || b.people - a.people)
    .slice(0, 6);

  // ---- Checklists ----
  const runs = db.prepare("SELECT sop_id, fail_count, results, snapshot, completed_at FROM checklist_runs WHERE status = 'completed' AND completed_at >= ?").all(since) as {
    sop_id: string;
    fail_count: number;
    results: string;
    snapshot: string;
    completed_at: string;
  }[];
  const perDayMap = new Map<string, { passed: number; failed: number }>();
  for (let i = days - 1; i >= 0; i--) perDayMap.set(isoDate(addDays(today(tz), -i)), { passed: 0, failed: 0 });
  const stepStats = new Map<string, { sopId: string; number: string; sopTitle: string; stepTitle: string; fails: number; checks: number }>();
  for (const r of runs) {
    const w = wallClock(tz, new Date(r.completed_at));
    const day = perDayMap.get(isoDate({ y: w.y, m: w.m, d: w.d }));
    if (day) r.fail_count ? day.failed++ : day.passed++;
    const snap = JSON.parse(r.snapshot) as { sop: Sop };
    const results = JSON.parse(r.results) as Record<string, CheckItemResult>;
    for (const st of snap.sop.content.steps) {
      const res = results[st.id]?.result;
      if (st.kind !== 'step' || (res !== 'pass' && res !== 'fail')) continue;
      const k = `${r.sop_id}|${st.id}`;
      const cur = stepStats.get(k) ?? { sopId: r.sop_id, number: snap.sop.number, sopTitle: snap.sop.title, stepTitle: st.title, fails: 0, checks: 0 };
      cur.checks++;
      if (res === 'fail') cur.fails++;
      stepStats.set(k, cur);
    }
  }
  const topFailed = [...stepStats.values()]
    .filter((x) => x.fails > 0)
    .map((x) => ({ ...x, rate: Math.round((x.fails / x.checks) * 100) }))
    .sort((a, b) => b.fails - a.fails || b.rate - a.rate)
    .slice(0, 8);

  // ---- Schedules ----
  const board = scheduleBoard(days);
  const activeSchedules = (db.prepare('SELECT COUNT(*) AS n FROM schedules WHERE active = 1').get() as { n: number }).n;

  // ---- Actions ----
  const act = db
    .prepare(
      `SELECT SUM(status IN ('open','in_progress')) AS open,
        SUM(status IN ('open','in_progress') AND due_date IS NOT NULL AND due_date < ?) AS overdue,
        SUM(status = 'done' AND resolved_at >= ?) AS closed,
        AVG(CASE WHEN status = 'done' AND resolved_at >= ? THEN julianday(resolved_at) - julianday(created_at) END) AS avg_days
       FROM actions`,
    )
    .get(todayIso, since, since) as { open: number | null; overdue: number | null; closed: number | null; avg_days: number | null };

  // ---- Views ----
  const trackedSince = (db.prepare('SELECT MIN(created_at) AS t FROM sop_views').get() as { t: string | null }).t;
  const floorViews = (db.prepare('SELECT COUNT(*) AS n FROM sop_views WHERE floor = 1 AND created_at >= ?').get(since) as { n: number }).n;
  const viewRows = db
    .prepare('SELECT sop_id, SUM(floor) AS floor, COUNT(*) AS total, MAX(CASE WHEN floor = 1 THEN created_at END) AS last_floor FROM sop_views WHERE created_at >= ? GROUP BY sop_id')
    .all(since) as { sop_id: string; floor: number; total: number; last_floor: string | null }[];
  const views = new Map(viewRows.map((r) => [r.sop_id, r]));
  const lastEver = new Map(
    (db.prepare('SELECT sop_id, MAX(created_at) AS t FROM sop_views WHERE floor = 1 GROUP BY sop_id').all() as { sop_id: string; t: string }[]).map((r) => [r.sop_id, r.t]),
  );
  const unopened = published
    .filter((s) => !(views.get(s.id)?.floor ?? 0))
    .map((s) => ({ sopId: s.id, number: s.number, title: s.title, approvedAt: s.approvedAt, lastFloorView: lastEver.get(s.id) ?? null }))
    .sort((a, b) => (a.approvedAt ?? '').localeCompare(b.approvedAt ?? ''))
    .slice(0, 10);
  const mostViewed = published
    .map((s) => ({ sopId: s.id, number: s.number, title: s.title, floorViews: views.get(s.id)?.floor ?? 0, totalViews: views.get(s.id)?.total ?? 0 }))
    .filter((x) => x.totalViews > 0)
    .sort((a, b) => b.floorViews - a.floorViews || b.totalViews - a.totalViews)
    .slice(0, 6);

  const n = (v: number | null | undefined) => v ?? 0;
  return {
    days,
    library: { total: n(lib.total), approved: n(lib.approved), drafts: n(lib.drafts), inReview: n(lib.review), reviewDue: n(lib.due), reviewOverdue: n(lib.overdue) },
    training: { current: curTotal, required: reqTotal, pct: reqTotal ? Math.round((curTotal / reqTotal) * 100) : null, needResign, teams: teamRows },
    quiz,
    checklists: {
      completed: runs.length,
      withFailures: runs.filter((r) => r.fail_count > 0).length,
      perDay: [...perDayMap.entries()].map(([date, v]) => ({ date, ...v })),
      topFailed,
    },
    schedules: { compliancePct: board.stats.compliancePct, done: board.stats.done + board.stats.failed, missed: board.stats.missed, dueNow: board.stats.dueNow, active: activeSchedules },
    actions: { open: n(act.open), overdue: n(act.overdue), closed: n(act.closed), avgDaysToClose: act.avg_days === null ? null : Math.round(act.avg_days * 10) / 10 },
    views: { trackedSince, floorViews, unopened, mostViewed },
  };
}
