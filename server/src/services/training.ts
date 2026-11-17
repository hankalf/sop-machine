import { isRequiredFor, quizActive } from '../../../shared/defaults';
import type { Acknowledgment, QuizResult, Sop, TrainingMatrix, TrainingPerson, User } from '../../../shared/types';
import { gradeQuiz, recordAttempt } from './quiz';
import { listTeams } from './teams';
import { translationFor } from './translations';
import { db } from '../db';
import { badRequest, newId, nowIso } from '../util';
import { getPublishedSop } from './sops';

interface AckRow {
  id: string;
  sop_id: string;
  revision_id: string | null;
  version: string;
  user_id: string | null;
  person_key: string;
  person_name: string;
  employee_id: string;
  method: Acknowledgment['method'];
  recorded_by: string | null;
  station_id: string | null;
  note: string;
  created_at: string;
  recorder_name?: string | null;
  station_name?: string | null;
}

export function personKey(p: { userId?: string | null; employeeId?: string; name: string }): string {
  if (p.userId) return `u:${p.userId}`;
  if (p.employeeId?.trim()) return `e:${p.employeeId.trim().toLowerCase()}`;
  return `n:${p.name.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

/** Record that someone read and understood the currently published revision. */
export function acknowledge(
  sopId: string,
  who: { userId?: string | null; name: string; employeeId?: string },
  meta: {
    method: Acknowledgment['method'];
    recordedBy?: string | null;
    stationId?: string | null;
    note?: string;
    /** Quiz answers (question id → option index) and the language they were shown in. */
    answers?: Record<string, number>;
    language?: string;
  },
): { created: boolean; version: string; quiz?: QuizResult } {
  const sop = getPublishedSop(sopId);
  if (!sop) throw badRequest('Only approved SOPs can be signed off');
  const name = who.name.trim();
  if (!name) throw badRequest('Enter a name');
  const key = personKey({ userId: who.userId, employeeId: who.employeeId, name });
  const existing = db.prepare('SELECT id FROM acknowledgments WHERE sop_id = ? AND version = ? AND person_key = ?').get(sop.id, sop.version, key);
  if (existing) return { created: false, version: sop.version };
  // Self sign-off needs the quiz; a supervisor recording a training session vouches for the group.
  if (meta.method !== 'recorded' && quizActive(sop.content)) {
    const translation = meta.language ? translationFor(sop, meta.language, 'exact') : null;
    const quiz = gradeQuiz(sop, meta.answers ?? {}, translation);
    recordAttempt(sop, key, quiz);
    if (!quiz.passed) return { created: false, version: sop.version, quiz };
  }
  db.prepare(
    `INSERT INTO acknowledgments (id, sop_id, revision_id, version, user_id, person_key, person_name, employee_id, method, recorded_by, station_id, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId(),
    sop.id,
    sop.publishedRevisionId,
    sop.version,
    who.userId ?? null,
    key,
    name.slice(0, 120),
    (who.employeeId ?? '').trim().slice(0, 60),
    meta.method,
    meta.recordedBy ?? null,
    meta.stationId ?? null,
    (meta.note ?? '').slice(0, 500),
    nowIso(),
  );
  return { created: true, version: sop.version };
}

const SELECT = `SELECT a.*, r.name AS recorder_name, st.name AS station_name FROM acknowledgments a
  LEFT JOIN users r ON r.id = a.recorded_by LEFT JOIN stations st ON st.id = a.station_id`;

function toAck(r: AckRow, publishedVersion: string | null): Acknowledgment {
  return {
    id: r.id,
    sopId: r.sop_id,
    version: r.version,
    personKey: r.person_key,
    personName: r.person_name,
    employeeId: r.employee_id,
    userId: r.user_id,
    method: r.method,
    recordedByName: r.recorder_name ?? null,
    stationName: r.station_name ?? null,
    note: r.note,
    createdAt: r.created_at,
    current: r.version === publishedVersion,
  };
}

/** Latest sign-off per person for one SOP. */
export function listAcknowledgments(sop: Sop): Acknowledgment[] {
  const rows = db.prepare(`${SELECT} WHERE a.sop_id = ? ORDER BY a.created_at DESC`).all(sop.id) as AckRow[];
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.person_key) ? false : (seen.add(r.person_key), true))).map((r) => toAck(r, sop.publishedVersion));
}

export function myAcknowledgment(sop: Sop, user: User): Acknowledgment | null {
  const r = db.prepare(`${SELECT} WHERE a.sop_id = ? AND a.person_key = ? ORDER BY a.created_at DESC LIMIT 1`).get(sop.id, personKey({ userId: user.id, name: user.name })) as AckRow | undefined;
  return r ? toAck(r, sop.publishedVersion) : null;
}

export function deleteAcknowledgment(id: string) {
  db.prepare('DELETE FROM acknowledgments WHERE id = ?').run(id);
}

/** Who has signed which approved SOP, and whether they are on the current revision. */
export function trainingMatrix(categoryId?: string): TrainingMatrix {
  const sopRows = db
    .prepare(
      `SELECT id FROM sops WHERE published_revision_id IS NOT NULL AND status != 'archived' ${categoryId ? 'AND category_id = ?' : ''} ORDER BY number`,
    )
    .all(...(categoryId ? [categoryId] : [])) as { id: string }[];
  const sops = sopRows.map((r) => getPublishedSop(r.id)).filter((s): s is Sop => !!s);
  const published = new Map(sops.map((s) => [s.id, s.version]));

  const people = new Map<string, TrainingPerson>();
  const users = db.prepare("SELECT id, name, role, team_id FROM users WHERE disabled = 0 AND role != 'admin' ORDER BY name").all() as {
    id: string;
    name: string;
    role: TrainingPerson['role'];
    team_id: string | null;
  }[];
  for (const u of users) people.set(`u:${u.id}`, { key: `u:${u.id}`, name: u.name, employeeId: '', userId: u.id, role: u.role, teamId: u.team_id, rosterId: null });
  const roster = db.prepare('SELECT * FROM people WHERE active = 1 ORDER BY name').all() as { id: string; name: string; employee_id: string; team_id: string | null }[];
  for (const p of roster) {
    const key = personKey({ employeeId: p.employee_id, name: p.name });
    people.set(key, { key, name: p.name, employeeId: p.employee_id, userId: null, role: null, teamId: p.team_id, rosterId: p.id });
  }

  const userInfo = new Map((db.prepare('SELECT id, role, team_id FROM users').all() as { id: string; role: TrainingPerson['role']; team_id: string | null }[]).map((u) => [u.id, u]));
  const cells: TrainingMatrix['cells'] = {};
  const acks = db.prepare('SELECT * FROM acknowledgments ORDER BY created_at ASC').all() as AckRow[];
  for (const a of acks) {
    if (!published.has(a.sop_id)) continue;
    if (!people.has(a.person_key)) {
      const u = a.user_id ? userInfo.get(a.user_id) : undefined;
      people.set(a.person_key, { key: a.person_key, name: a.person_name, employeeId: a.employee_id, userId: a.user_id, role: u?.role ?? null, teamId: u?.team_id ?? null, rosterId: null });
    }
    (cells[a.person_key] ??= {})[a.sop_id] = { version: a.version, current: a.version === published.get(a.sop_id), at: a.created_at };
  }
  return {
    teams: listTeams(),
    people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
    sops: sops.map((s) => ({ id: s.id, number: s.number, title: s.title, version: s.version, categoryId: s.categoryId })),
    cells,
  };
}

export function matrixCsv(m: TrainingMatrix): string {
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const teams = new Map(m.teams.map((t) => [t.id, t]));
  const header = ['Name', 'Employee ID', 'Team', ...m.sops.map((s) => `${s.number} ${s.title} (Rev ${s.version})`)].map(q).join(',');
  const lines = m.people.map((p) =>
    [
      p.name,
      p.employeeId,
      p.teamId ? (teams.get(p.teamId)?.name ?? '') : '',
      ...m.sops.map((s) => {
        const c = m.cells[p.key]?.[s.id];
        if (!c) return isRequiredFor(p.teamId ? teams.get(p.teamId) : null, s) ? 'Not signed' : 'Not required';
        return `${c.current ? 'Current' : `Needs re-sign (signed Rev ${c.version})`} ${c.at.slice(0, 10)}`;
      }),
    ]
      .map(q)
      .join(','),
  );
  return [header, ...lines].join('\r\n');
}
