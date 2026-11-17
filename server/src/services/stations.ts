import crypto from 'node:crypto';
import type { Sop, Station, StationSopSummary } from '../../../shared/types';
import { config } from '../config';
import { db } from '../db';
import { referencedMediaIds } from '../render/context';
import { newId, notFound, nowIso } from '../util';
import { getPublishedSop } from './sops';
import { getCategory } from './templates';
import { quizActive } from '../../../shared/defaults';
import { dueAtStation } from './schedules';
import { exactLanguages, translationFor } from './translations';

interface StationRow {
  id: string;
  name: string;
  area: string;
  token: string;
  sop_ids: string;
  public_access: number;
  supervisor_user_id: string | null;
  created_at: string;
  updated_at: string;
}

const toStation = (r: StationRow): Station => ({
  id: r.id,
  name: r.name,
  area: r.area,
  token: r.token,
  sopIds: JSON.parse(r.sop_ids),
  publicAccess: !!r.public_access,
  supervisorUserId: r.supervisor_user_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const newToken = () => crypto.randomBytes(15).toString('base64url');

export const stationUrl = (s: Station) => `${config.appUrl}/s/${s.token}`;
export const stationSopUrl = (s: Station, sopId: string) => `${config.appUrl}/s/${s.token}/sop/${sopId}`;

export function listStations(): Station[] {
  return (db.prepare('SELECT * FROM stations ORDER BY name').all() as StationRow[]).map(toStation);
}

export function getStation(id: string): Station {
  const r = db.prepare('SELECT * FROM stations WHERE id = ?').get(id) as StationRow | undefined;
  if (!r) throw notFound('Station not found');
  return toStation(r);
}

export function stationByToken(token: string): Station {
  const r = db.prepare('SELECT * FROM stations WHERE token = ?').get(token) as StationRow | undefined;
  if (!r) throw notFound('This QR code is no longer active. Ask your supervisor for the current one.');
  return toStation(r);
}

export function saveStation(
  id: string | null,
  input: { name: string; area: string; sopIds: string[]; publicAccess: boolean; supervisorUserId: string | null },
): Station {
  const now = nowIso();
  if (id) {
    const res = db
      .prepare('UPDATE stations SET name = ?, area = ?, sop_ids = ?, public_access = ?, supervisor_user_id = ?, updated_at = ? WHERE id = ?')
      .run(input.name, input.area, JSON.stringify(input.sopIds), input.publicAccess ? 1 : 0, input.supervisorUserId, now, id);
    if (!res.changes) throw notFound('Station not found');
    return getStation(id);
  }
  const sid = newId();
  db.prepare(
    'INSERT INTO stations (id, name, area, token, sop_ids, public_access, supervisor_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(sid, input.name, input.area, newToken(), JSON.stringify(input.sopIds), input.publicAccess ? 1 : 0, input.supervisorUserId, now, now);
  return getStation(sid);
}

/** Invalidate printed placards (e.g. one was lost or posted somewhere public). */
export function rotateToken(id: string): Station {
  db.prepare('UPDATE stations SET token = ?, updated_at = ? WHERE id = ?').run(newToken(), nowIso(), id);
  return getStation(id);
}

export function deleteStation(id: string) {
  db.prepare('DELETE FROM stations WHERE id = ?').run(id);
}

export function stationsForSop(sopId: string): Station[] {
  return listStations().filter((s) => s.sopIds.includes(sopId));
}

/** Approved SOPs at a station, in the order the admin set. */
export function stationSops(station: Station): Sop[] {
  return station.sopIds.map((id) => {
    try {
      return getPublishedSop(id);
    } catch {
      return null;
    }
  }).filter((s): s is Sop => !!s);
}

export function summarizeForStation(sop: Sop, stationId: string): StationSopSummary {
  const cat = getCategory(sop.categoryId);
  const languages = exactLanguages(sop);
  const titles: Record<string, string> = {};
  for (const code of languages) titles[code] = translationFor(sop, code, 'exact')?.content.title || sop.title;
  return {
    id: sop.id,
    number: sop.number,
    title: sop.title,
    version: sop.version,
    effectiveDate: sop.effectiveDate,
    categoryName: cat?.name ?? null,
    categoryColor: cat?.color ?? null,
    checklist: sop.content.checklist.enabled,
    quiz: quizActive(sop.content),
    due: sop.content.checklist.enabled ? dueAtStation(sop.id, stationId) : null,
    languages,
    titles,
  };
}

export function stationSop(station: Station, sopId: string): Sop {
  if (!station.sopIds.includes(sopId)) throw notFound('That SOP is not posted at this station');
  const sop = getPublishedSop(sopId);
  if (!sop) throw notFound('That SOP is not approved yet');
  return sop;
}

/** Media a station page may show: only files used by its approved SOPs. */
export function stationAllowsMedia(station: Station, mediaId: string): boolean {
  return stationSops(station).some((s) => referencedMediaIds(s).includes(mediaId));
}
