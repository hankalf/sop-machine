import type { ActionCounts, ActionStatus, ChecklistRun, CorrectiveAction, User } from '../../../shared/types';
import { config } from '../config';
import { db } from '../db';
import { badRequest, escapeHtml, newId, notFound, nowIso } from '../util';
import { getSettings } from './settings';
import { addDays, isoDate, siteZone, today } from './zoned';

interface ActionRow {
  id: string;
  title: string;
  detail: string;
  status: ActionStatus;
  priority: 'normal' | 'high';
  sop_id: string | null;
  station_id: string | null;
  run_id: string | null;
  step_id: string | null;
  reported_by: string;
  media_ids: string;
  assignee_id: string | null;
  due_date: string | null;
  resolution: string;
  resolved_by: string | null;
  resolved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  sop_number: string | null;
  sop_title: string | null;
  station_name: string | null;
  assignee_name: string | null;
  resolver_name: string | null;
}

const SELECT = `SELECT a.*, s.number AS sop_number, s.title AS sop_title, st.name AS station_name, u.name AS assignee_name, r.name AS resolver_name
  FROM actions a LEFT JOIN sops s ON s.id = a.sop_id LEFT JOIN stations st ON st.id = a.station_id
  LEFT JOIN users u ON u.id = a.assignee_id LEFT JOIN users r ON r.id = a.resolved_by`;

export const siteToday = () => isoDate(today(siteZone(getSettings().schedule.timezone)));
const OPEN = new Set<ActionStatus>(['open', 'in_progress']);

function toAction(r: ActionRow, todayIso = siteToday()): CorrectiveAction {
  return {
    id: r.id,
    title: r.title,
    detail: r.detail,
    status: r.status,
    priority: r.priority,
    sopId: r.sop_id,
    sopNumber: r.sop_number,
    sopTitle: r.sop_title,
    stationId: r.station_id,
    stationName: r.station_name,
    runId: r.run_id,
    stepId: r.step_id,
    reportedBy: r.reported_by,
    mediaIds: JSON.parse(r.media_ids),
    assigneeId: r.assignee_id,
    assigneeName: r.assignee_name,
    dueDate: r.due_date,
    overdue: OPEN.has(r.status) && !!r.due_date && r.due_date < todayIso,
    resolution: r.resolution,
    resolvedByName: r.resolver_name,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function getAction(id: string): CorrectiveAction {
  const r = db.prepare(`${SELECT} WHERE a.id = ?`).get(id) as ActionRow | undefined;
  if (!r) throw notFound('Action not found');
  return toAction(r);
}

export function listActions(q: { status?: string; assigneeId?: string; overdue?: boolean; sopId?: string; stationId?: string }): CorrectiveAction[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.status === 'open') where.push("a.status IN ('open', 'in_progress')");
  else if (q.status === 'closed') where.push("a.status IN ('done', 'cancelled')");
  else if (q.status) (where.push('a.status = ?'), params.push(q.status));
  if (q.assigneeId) (where.push('a.assignee_id = ?'), params.push(q.assigneeId));
  if (q.sopId) (where.push('a.sop_id = ?'), params.push(q.sopId));
  if (q.stationId) (where.push('a.station_id = ?'), params.push(q.stationId));
  if (q.overdue) (where.push("a.status IN ('open', 'in_progress') AND a.due_date IS NOT NULL AND a.due_date < ?"), params.push(siteToday()));
  const rows = db
    .prepare(
      `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY CASE WHEN a.status IN ('open','in_progress') THEN 0 ELSE 1 END, a.priority = 'high' DESC, COALESCE(a.due_date, '9999') ASC, a.created_at DESC LIMIT 500`,
    )
    .all(...params) as ActionRow[];
  const t = siteToday();
  return rows.map((r) => toAction(r, t));
}

export function actionCounts(userId: string): ActionCounts {
  const t = siteToday();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS open,
         SUM(CASE WHEN due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END) AS overdue,
         SUM(CASE WHEN assignee_id = ? THEN 1 ELSE 0 END) AS mine
       FROM actions WHERE status IN ('open', 'in_progress')`,
    )
    .get(t, userId) as { open: number; overdue: number | null; mine: number | null };
  return { open: row.open, overdue: row.overdue ?? 0, mine: row.mine ?? 0 };
}

function defaultDue(): string {
  return isoDate(addDays(today(siteZone(getSettings().schedule.timezone)), Math.max(0, getSettings().actions.defaultDueDays)));
}

export interface ActionInput {
  title: string;
  detail: string;
  priority: 'normal' | 'high';
  sopId: string | null;
  stationId: string | null;
  assigneeId: string | null;
  dueDate: string | null;
}

export function createAction(input: ActionInput, user: User): CorrectiveAction {
  const id = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO actions (id, title, detail, priority, sop_id, station_id, reported_by, assignee_id, due_date, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.title, input.detail, input.priority, input.sopId, input.stationId, user.name, input.assigneeId, input.dueDate ?? defaultDue(), user.id, now, now);
  return getAction(id);
}

export function updateAction(
  id: string,
  patch: Partial<ActionInput> & { status?: ActionStatus; resolution?: string },
  user: User,
): { action: CorrectiveAction; reassigned: boolean } {
  const cur = getAction(id);
  const status = patch.status ?? cur.status;
  const resolution = patch.resolution ?? cur.resolution;
  if (status === 'done' && !resolution.trim()) throw badRequest('Say what was done to fix it');
  const closing = !OPEN.has(status) && OPEN.has(cur.status);
  const reopening = OPEN.has(status) && !OPEN.has(cur.status);
  const assigneeId = patch.assigneeId !== undefined ? patch.assigneeId : cur.assigneeId;
  db.prepare(
    `UPDATE actions SET title = ?, detail = ?, priority = ?, status = ?, assignee_id = ?, due_date = ?, resolution = ?,
       resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?`,
  ).run(
    patch.title ?? cur.title,
    patch.detail ?? cur.detail,
    patch.priority ?? cur.priority,
    status,
    assigneeId,
    patch.dueDate !== undefined ? patch.dueDate : cur.dueDate,
    resolution,
    closing ? user.id : reopening ? null : (db.prepare('SELECT resolved_by FROM actions WHERE id = ?').get(id) as { resolved_by: string | null }).resolved_by,
    closing ? nowIso() : reopening ? null : cur.resolvedAt,
    nowIso(),
    id,
  );
  return { action: getAction(id), reassigned: !!assigneeId && assigneeId !== cur.assigneeId && assigneeId !== user.id };
}

export function deleteAction(id: string) {
  db.prepare('DELETE FROM actions WHERE id = ?').run(id);
}

/** One action per failed item of a completed checklist. Returns the ones created. */
export function actionsFromRun(run: ChecklistRun, stationSupervisor: string | null, sopOwner: string | null): CorrectiveAction[] {
  const created: CorrectiveAction[] = [];
  const now = nowIso();
  const due = defaultDue();
  const assignee = stationSupervisor ?? sopOwner;
  for (const step of run.steps) {
    const res = run.results[step.id];
    if (step.kind !== 'step' || res?.result !== 'fail') continue;
    const id = newId();
    const high = step.callout.type === 'danger' || step.callout.type === 'warning';
    const where = [run.stationName, ...run.fieldValues.filter((f) => f.value).map((f) => `${f.label} ${f.value}`)].filter(Boolean).join(', ');
    const inserted = db
      .prepare(
        `INSERT OR IGNORE INTO actions (id, title, detail, priority, sop_id, station_id, run_id, step_id, reported_by, media_ids, assignee_id, due_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, (SELECT station_id FROM checklist_runs WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        `Failed: ${step.title}${where ? ` (${where})` : ''}`.slice(0, 200),
        res.note,
        high ? 'high' : 'normal',
        run.sopId,
        run.id,
        run.id,
        step.id,
        run.performerName,
        JSON.stringify(res.mediaIds),
        assignee,
        due,
        now,
        now,
      );
    if (inserted.changes) created.push(getAction(id));
  }
  return created;
}

export const actionsUrl = (id?: string) => `${config.appUrl}/actions${id ? `?id=${id}` : ''}`;

export function actionRowsHtml(list: CorrectiveAction[]): string {
  return list
    .map((a) => `<li style="margin:0 0 6px"><strong>${escapeHtml(a.title)}</strong>${a.detail ? `<br><span style="color:#b91c1c">${escapeHtml(a.detail)}</span>` : ''}</li>`)
    .join('');
}
