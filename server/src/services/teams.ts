import type { RosterPerson, Team } from '../../../shared/types';
import { db } from '../db';
import { badRequest, newId, notFound, nowIso } from '../util';

interface TeamRow {
  id: string;
  name: string;
  category_ids: string;
  sop_ids: string;
  created_at: string;
}

interface PersonRow {
  id: string;
  name: string;
  employee_id: string;
  team_id: string | null;
  active: number;
}

export function listTeams(): Team[] {
  const rows = db.prepare('SELECT * FROM teams ORDER BY name').all() as TeamRow[];
  const counts = new Map<string, number>();
  for (const r of db.prepare("SELECT team_id AS t, COUNT(*) AS n FROM users WHERE disabled = 0 AND team_id IS NOT NULL AND role != 'admin' GROUP BY team_id").all() as { t: string; n: number }[]) counts.set(r.t, r.n);
  for (const r of db.prepare('SELECT team_id AS t, COUNT(*) AS n FROM people WHERE active = 1 AND team_id IS NOT NULL GROUP BY team_id').all() as { t: string; n: number }[]) counts.set(r.t, (counts.get(r.t) ?? 0) + r.n);
  return rows.map((r) => ({ id: r.id, name: r.name, categoryIds: JSON.parse(r.category_ids), sopIds: JSON.parse(r.sop_ids), memberCount: counts.get(r.id) ?? 0 }));
}

export function saveTeam(id: string | null, t: { name: string; categoryIds: string[]; sopIds: string[] }): Team {
  const tid = id ?? newId();
  if (id) {
    const res = db.prepare('UPDATE teams SET name = ?, category_ids = ?, sop_ids = ? WHERE id = ?').run(t.name, JSON.stringify(t.categoryIds), JSON.stringify(t.sopIds), id);
    if (!res.changes) throw notFound('Team not found');
  } else {
    db.prepare('INSERT INTO teams (id, name, category_ids, sop_ids, created_at) VALUES (?, ?, ?, ?, ?)').run(tid, t.name, JSON.stringify(t.categoryIds), JSON.stringify(t.sopIds), nowIso());
  }
  return listTeams().find((x) => x.id === tid)!;
}

export function deleteTeam(id: string) {
  db.transaction(() => {
    db.prepare('UPDATE users SET team_id = NULL WHERE team_id = ?').run(id);
    db.prepare('UPDATE people SET team_id = NULL WHERE team_id = ?').run(id);
    db.prepare('DELETE FROM teams WHERE id = ?').run(id);
  })();
}

const toPerson = (r: PersonRow): RosterPerson => ({ id: r.id, name: r.name, employeeId: r.employee_id, teamId: r.team_id, active: !!r.active });

export function listRoster(): RosterPerson[] {
  return (db.prepare('SELECT * FROM people ORDER BY active DESC, name').all() as PersonRow[]).map(toPerson);
}

export function savePerson(id: string | null, p: { name: string; employeeId: string; teamId: string | null; active: boolean }): RosterPerson {
  const name = p.name.trim();
  if (!name) throw badRequest('Enter a name');
  const emp = p.employeeId.trim();
  if (emp) {
    const dup = db.prepare('SELECT id FROM people WHERE lower(employee_id) = lower(?) AND id != ?').get(emp, id ?? '') as { id: string } | undefined;
    if (dup) throw badRequest(`Employee ID ${emp} is already on the roster`);
  }
  const pid = id ?? newId();
  if (id) {
    const res = db.prepare('UPDATE people SET name = ?, employee_id = ?, team_id = ?, active = ? WHERE id = ?').run(name, emp, p.teamId, p.active ? 1 : 0, id);
    if (!res.changes) throw notFound('Person not found');
  } else {
    db.prepare('INSERT INTO people (id, name, employee_id, team_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(pid, name, emp, p.teamId, p.active ? 1 : 0, nowIso());
  }
  return toPerson(db.prepare('SELECT * FROM people WHERE id = ?').get(pid) as PersonRow);
}

/** Paste from a spreadsheet: "Name, Employee ID" per line. Updates people that already match. */
export function importRoster(lines: string, teamId: string | null): { added: number; updated: number } {
  let added = 0;
  let updated = 0;
  db.transaction(() => {
    for (const raw of lines.split(/\r?\n/)) {
      const [name = '', emp = ''] = raw.split(/[,;\t]/).map((x) => x.trim());
      if (!name || /^name$/i.test(name)) continue;
      const existing = (emp
        ? db.prepare('SELECT id FROM people WHERE lower(employee_id) = lower(?)').get(emp)
        : db.prepare("SELECT id FROM people WHERE employee_id = '' AND lower(name) = lower(?)").get(name)) as { id: string } | undefined;
      if (existing) {
        db.prepare('UPDATE people SET name = ?, team_id = COALESCE(?, team_id), active = 1 WHERE id = ?').run(name, teamId, existing.id);
        updated++;
      } else {
        db.prepare('INSERT INTO people (id, name, employee_id, team_id, active, created_at) VALUES (?, ?, ?, ?, 1, ?)').run(newId(), name, emp, teamId, nowIso());
        added++;
      }
    }
  })();
  return { added, updated };
}

export function deletePerson(id: string) {
  db.prepare('DELETE FROM people WHERE id = ?').run(id);
}
