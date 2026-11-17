import crypto from 'node:crypto';
import { db } from '../db';
import { nowIso } from '../util';

/** Count an SOP being opened. Repeat opens by the same viewer within 30 minutes count once. */
export function recordView(sopId: string, viewerKey: string, floor: boolean, stationId: string | null = null) {
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const recent = db.prepare('SELECT 1 FROM sop_views WHERE sop_id = ? AND viewer_key = ? AND created_at > ?').get(sopId, viewerKey, since);
  if (recent) return;
  db.prepare('INSERT INTO sop_views (sop_id, viewer_key, floor, station_id, created_at) VALUES (?, ?, ?, ?, ?)').run(sopId, viewerKey, floor ? 1 : 0, stationId, nowIso());
}

/** Anonymous station visitors: a daily hash of their address, never stored in the clear. */
export function anonymousKey(ip: string | undefined, stationId: string) {
  const day = new Date().toISOString().slice(0, 10);
  return `a:${crypto.createHash('sha256').update(`${ip ?? '?'}|${stationId}|${day}`).digest('hex').slice(0, 16)}`;
}
