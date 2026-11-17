import type { Occurrence } from '../../../shared/types';
import { config } from '../config';
import { db } from '../db';
import { escapeHtml as e, formatDate, newId, nowIso } from '../util';
import { actionRowsHtml, actionsFromRun, actionsUrl, listActions } from './actions';
import { emailConfigured } from './mailer';
import { sopEvents } from './events';
import { admins, deliver, emailHtml, extras, userById } from './notifications';
import { occurrences } from './schedules';
import { getSettings } from './settings';
import { getSop } from './sops';

/** Failed checklists, action assignments, overdue actions and missed scheduled checklists. */
export function startAlerts() {
  sopEvents.onSop('checklistCompleted', async (run) => {
    if (!run.failCount) return;
    const s = getSettings();
    const station = run.stationName ? (db.prepare('SELECT supervisor_user_id FROM checklist_runs r JOIN stations st ON st.id = r.station_id WHERE r.id = ?').get(run.id) as { supervisor_user_id: string | null } | undefined) : undefined;
    let owner: string | null = null;
    try {
      owner = getSop(run.sopId).ownerUserId;
    } catch {
      /* SOP deleted */
    }
    const supervisor = station?.supervisor_user_id ?? null;
    const created = s.actions.autoCreate ? actionsFromRun(run, supervisor, owner) : [];
    if (!s.notifications.onChecklistFailed) return;
    const lead = userById(supervisor) ?? userById(owner);
    const to = [...(lead ? [lead.email] : admins().map((a) => a.email)), ...extras()];
    const failed = run.steps.filter((st) => run.results[st.id]?.result === 'fail');
    const where = [run.stationName, ...run.fieldValues.filter((f) => f.value).map((f) => `${f.label} ${f.value}`)].filter(Boolean).join(' · ');
    const subject = `Checklist failed: ${run.sopNumber} ${run.sopTitle}${run.stationName ? ` at ${run.stationName}` : ''}`;
    const items = failed.map((st) => `- ${st.title}${run.results[st.id]?.note ? `: ${run.results[st.id].note}` : ''}`).join('\n');
    const html = emailHtml({
      heading: `${failed.length} item${failed.length === 1 ? '' : 's'} failed`,
      intro: `${run.performerName} completed the ${run.sopTitle} checklist${where ? ` (${where})` : ''} and reported problems.${created.length ? ` ${created.length} corrective action${created.length === 1 ? ' was' : 's were'} opened.` : ''}`,
      rows: failed.map((st) => [st.title, run.results[st.id]?.note || 'No note'] as [string, string]),
      button: { label: created.length ? 'Open corrective actions' : 'Open the record', url: created.length ? actionsUrl() : `${config.appUrl}/records?sopId=${run.sopId}` },
    });
    await deliver('checklist-failed', `failed:${run.id}`, null, to, subject, html, `${subject}\n${items}\n${actionsUrl()}`);
  });

  sopEvents.onSop('actionReassigned', async (a, by) => {
    if (!getSettings().notifications.onActionAssigned) return;
    const who = userById(a.assigneeId);
    if (!who) return;
    const subject = `Assigned to you: ${a.title}`;
    const html = emailHtml({
      heading: 'A corrective action was assigned to you',
      intro: `${by.name} assigned this to you${a.dueDate ? `, due ${formatDate(a.dueDate)}` : ''}.`,
      rows: [
        ['Action', a.title],
        ...(a.detail ? [['Details', a.detail] as [string, string]] : []),
        ...(a.sopNumber ? [['SOP', `${a.sopNumber} ${a.sopTitle}`] as [string, string]] : []),
        ...(a.stationName ? [['Station', a.stationName] as [string, string]] : []),
      ],
      button: { label: 'Open action', url: actionsUrl(a.id) },
    });
    await deliver('action-assigned', `assigned:${a.id}:${a.assigneeId}:${a.updatedAt}`, null, [who.email], subject, html, `${subject}\n${actionsUrl(a.id)}`);
  });

  const tick = () => void Promise.all([overdueActions(), missedChecklists()]).catch((err) => console.error('[alerts] failed', err));
  setTimeout(tick, 45_000);
  setInterval(tick, 15 * 60 * 1000);
}

/** One reminder per action per due date, to whoever it is assigned to (or the admins). */
async function overdueActions() {
  if (!emailConfigured || !getSettings().notifications.enabled) return;
  const overdue = listActions({ overdue: true });
  const byPerson = new Map<string, typeof overdue>();
  for (const a of overdue) {
    const key = a.assigneeId ?? '';
    byPerson.set(key, [...(byPerson.get(key) ?? []), a]);
  }
  for (const [assignee, list] of byPerson) {
    const fresh = list.filter((a) => !db.prepare('SELECT 1 FROM notifications WHERE dedupe_key = ?').get(`overdue:${a.id}:${a.dueDate}`));
    if (!fresh.length) continue;
    const who = userById(assignee || null);
    const to = who ? [who.email] : admins().map((x) => x.email);
    const subject = `${fresh.length} corrective action${fresh.length === 1 ? ' is' : 's are'} overdue`;
    const html = emailHtml({
      heading: subject,
      intro: who ? 'These were assigned to you and are past their due date.' : 'These have no one assigned and are past their due date.',
      button: { label: 'Open corrective actions', url: actionsUrl() },
    }).replace('</p>', `</p><ul style="padding-left:18px;font-size:14px;color:#0f172a">${actionRowsHtml(fresh)}</ul>`);
    await deliver('action-overdue', `overdue-batch:${fresh.map((a) => a.id).join(',')}:${nowIso().slice(0, 10)}`, null, to, subject, html, `${subject}\n${actionsUrl()}`);
    markSent(fresh.map((a) => `overdue:${a.id}:${a.dueDate}`));
  }
}

function markSent(keys: string[]) {
  const ins = db.prepare("INSERT OR IGNORE INTO notifications (id, kind, dedupe_key, sop_id, recipients, subject, status, created_at) VALUES (?, 'marker', ?, NULL, '', '', 'marker', ?)");
  for (const k of keys) ins.run(newId(), k, nowIso());
}

/** Scheduled checklists that ended without being done, grouped into one email per supervisor. */
async function missedChecklists() {
  const s = getSettings();
  if (!emailConfigured || !s.notifications.enabled || !s.notifications.onMissedChecklist) return;
  const now = new Date();
  const missed = occurrences(new Date(now.getTime() - 6 * 3600e3), now).filter((o) => o.status === 'missed' && new Date(o.end) > new Date(now.getTime() - 6 * 3600e3));
  const keyOf = (o: Occurrence) => `missed:${o.scheduleId}:${o.stationId ?? '-'}:${o.start}`;
  const fresh = missed.filter((o) => !db.prepare('SELECT 1 FROM notifications WHERE dedupe_key = ?').get(keyOf(o)));
  if (!fresh.length) return;
  const supervisors = new Map((db.prepare('SELECT id, supervisor_user_id FROM stations').all() as { id: string; supervisor_user_id: string | null }[]).map((r) => [r.id, r.supervisor_user_id]));
  const groups = new Map<string, Occurrence[]>();
  for (const o of fresh) {
    const sup = (o.stationId && supervisors.get(o.stationId)) || '';
    groups.set(sup, [...(groups.get(sup) ?? []), o]);
  }
  for (const [sup, list] of groups) {
    const who = userById(sup || null);
    const to = [...(who ? [who.email] : admins().map((a) => a.email)), ...extras()];
    const subject = `Missed checklist${list.length === 1 ? '' : 's'}: ${list.length === 1 ? `${list[0].sopTitle}${list[0].stationName ? ` at ${list[0].stationName}` : ''}` : `${list.length} not done`}`;
    const rows = list.map((o) => `<li style="margin:0 0 6px"><strong>${e(o.sopTitle)}</strong>${o.stationName ? ` at ${e(o.stationName)}` : ''}<br><span style="color:#64748b">${e(o.label)}</span></li>`).join('');
    const html = emailHtml({
      heading: subject,
      intro: 'These scheduled checklists were not completed in time.',
      button: { label: 'Open the schedule', url: `${config.appUrl}/schedules` },
    }).replace('</p>', `</p><ul style="padding-left:18px;font-size:14px;color:#0f172a">${rows}</ul>`);
    await deliver('checklist-missed', `missed-batch:${list.map(keyOf).join('|').slice(0, 900)}`, null, to, subject, html, `${subject}\n${config.appUrl}/schedules`);
    markSent(list.map(keyOf));
  }
}
