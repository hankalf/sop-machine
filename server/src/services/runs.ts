import crypto from 'node:crypto';
import type { CheckItemResult, ChecklistRun, ChecklistRunSummary, CheckResult, Sop, SopTranslation, User } from '../../../shared/types';
import { db } from '../db';
import { CALLOUT_META } from '../../../shared/defaults';
import { mdToHtml } from '../render/markdown';
import { referencedMediaIds } from '../render/context';
import { badRequest, newId, notFound, nowIso } from '../util';
import { getPublishedSop, getSop } from './sops';
import { sopEvents } from './events';
import { translationFor } from './translations';

interface RunRow {
  id: string;
  token: string;
  sop_id: string;
  version: string;
  station_id: string | null;
  user_id: string | null;
  performer_name: string;
  employee_id: string;
  language: string;
  fields: string;
  results: string;
  status: 'in_progress' | 'completed';
  fail_count: number;
  signature: string;
  snapshot: string;
  started_at: string;
  completed_at: string | null;
  station_name?: string | null;
}

interface RunSnapshot {
  sop: Sop;
  translation: SopTranslation | null;
}

const SELECT = 'SELECT r.*, st.name AS station_name FROM checklist_runs r LEFT JOIN stations st ON st.id = r.station_id';

function summary(r: RunRow): ChecklistRunSummary {
  const snap = JSON.parse(r.snapshot) as RunSnapshot;
  const values = JSON.parse(r.fields) as Record<string, string>;
  return {
    fieldValues: snap.sop.content.checklist.fields.map((f) => ({ label: f.label, value: values[f.id] ?? '' })),
    id: r.id,
    token: r.token,
    sopId: r.sop_id,
    sopNumber: snap.sop.number,
    sopTitle: snap.sop.title,
    version: r.version,
    stationName: r.station_name ?? null,
    performerName: r.performer_name,
    employeeId: r.employee_id,
    fields: values,
    status: r.status,
    failCount: r.fail_count,
    startedAt: r.started_at,
    completedAt: r.completed_at,
  };
}

/** translated: show the associate's language (run page). Records for supervisors stay in English. */
function toRun(r: RunRow, mediaBase: string, translated: boolean): ChecklistRun {
  const snap = JSON.parse(r.snapshot) as RunSnapshot;
  const t = translated ? snap.translation?.content : undefined;
  const strings = translated ? snap.translation?.strings : undefined;
  let n = 0;
  const steps = snap.sop.content.steps.map((s) => {
    const ts = t?.steps.find((x) => x.id === s.id);
    return {
      id: s.id,
      kind: s.kind,
      number: s.kind === 'step' ? ++n : 0,
      title: ts?.title || s.title,
      bodyHtml: mdToHtml(ts?.body || s.body),
      callout: {
        type: s.callout.type,
        html: s.callout.type === 'none' ? '' : mdToHtml(ts?.callout || s.callout.text),
        label: s.callout.type === 'none' ? '' : strings?.[s.callout.type] || CALLOUT_META[s.callout.type].label,
      },
      mediaIds: s.media.map((m) => m.mediaId),
    };
  });
  const labels: Record<string, string> = {};
  snap.sop.content.checklist.fields.forEach((f, i) => (labels[f.id] = t?.checklistFields[i] || f.label));
  return {
    ...summary(r),
    sopTitle: t?.title || snap.sop.title,
    language: r.language,
    results: JSON.parse(r.results),
    signature: r.signature,
    checklist: snap.sop.content.checklist,
    fieldLabels: labels,
    steps,
    mediaBase,
  };
}

function rowByToken(token: string): RunRow {
  const r = db.prepare(`${SELECT} WHERE r.token = ?`).get(token) as RunRow | undefined;
  if (!r) throw notFound('Checklist not found');
  return r;
}

export function getRunByToken(token: string): ChecklistRun {
  return toRun(rowByToken(token), `/api/public/runs/${token}/media`, true);
}

export function getRunById(id: string): ChecklistRun {
  const r = db.prepare(`${SELECT} WHERE r.id = ?`).get(id) as RunRow | undefined;
  if (!r) throw notFound('Checklist not found');
  return toRun(r, '/api/media', false);
}

export function startRun(input: {
  sopId: string;
  user: User | null;
  name: string;
  employeeId: string;
  stationId: string | null;
  language: string;
  fields: Record<string, string>;
}): ChecklistRun {
  const sop = getPublishedSop(input.sopId) ?? (input.user && input.user.role !== 'viewer' ? getSop(input.sopId) : null);
  if (!sop) throw badRequest('Only approved SOPs can be run as checklists');
  if (!sop.content.checklist.enabled) throw badRequest('This SOP is not set up as a checklist');
  const name = (input.user?.name ?? input.name).trim();
  if (!name) throw badRequest('Enter your name');
  const translation = input.language && input.language !== 'en' ? translationFor(sop, input.language, 'exact') : null;
  const id = newId();
  const token = crypto.randomBytes(16).toString('base64url');
  db.prepare(
    `INSERT INTO checklist_runs (id, token, sop_id, version, station_id, user_id, performer_name, employee_id, language, fields, results, snapshot, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
  ).run(
    id,
    token,
    sop.id,
    sop.version,
    input.stationId,
    input.user?.id ?? null,
    name.slice(0, 120),
    input.employeeId.trim().slice(0, 60),
    translation ? translation.language : 'en',
    JSON.stringify(cleanFields(sop, input.fields)),
    JSON.stringify({ sop, translation } satisfies RunSnapshot),
    nowIso(),
  );
  return getRunByToken(token);
}

function cleanFields(sop: Sop, fields: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const f of sop.content.checklist.fields) out[f.id] = String(fields?.[f.id] ?? '').slice(0, 200);
  return out;
}

const RESULTS: CheckResult[] = ['pass', 'fail', 'na', 'done'];

export function updateRun(token: string, patch: { fields?: Record<string, string>; results?: Record<string, Partial<CheckItemResult>> }): ChecklistRun {
  const r = rowByToken(token);
  if (r.status === 'completed') throw badRequest('This checklist is already completed');
  const snap = JSON.parse(r.snapshot) as RunSnapshot;
  const stepIds = new Set(snap.sop.content.steps.filter((s) => s.kind === 'step').map((s) => s.id));
  const results = JSON.parse(r.results) as Record<string, CheckItemResult>;
  for (const [stepId, p] of Object.entries(patch.results ?? {})) {
    if (!stepIds.has(stepId)) continue;
    const cur = results[stepId] ?? { result: null, note: '', mediaIds: [], at: null };
    const next: CheckItemResult = {
      result: p.result === null || (p.result && RESULTS.includes(p.result)) ? (p.result ?? null) : cur.result,
      note: typeof p.note === 'string' ? p.note.slice(0, 1000) : cur.note,
      mediaIds: Array.isArray(p.mediaIds) ? p.mediaIds.filter((x) => typeof x === 'string').slice(0, 10) : cur.mediaIds,
      at: nowIso(),
    };
    results[stepId] = next;
  }
  const fields = patch.fields ? cleanFields(snap.sop, patch.fields) : JSON.parse(r.fields);
  const fails = Object.values(results).filter((x) => x.result === 'fail').length;
  db.prepare('UPDATE checklist_runs SET results = ?, fields = ?, fail_count = ?, last_activity_at = ? WHERE id = ?').run(JSON.stringify(results), JSON.stringify(fields), fails, nowIso(), r.id);
  return getRunByToken(token);
}

export function completeRun(token: string, signature: string): ChecklistRun {
  const r = rowByToken(token);
  if (r.status === 'completed') return getRunByToken(token);
  const snap = JSON.parse(r.snapshot) as RunSnapshot;
  const cfg = snap.sop.content.checklist;
  const results = JSON.parse(r.results) as Record<string, CheckItemResult>;
  const fields = JSON.parse(r.fields) as Record<string, string>;
  const missingField = cfg.fields.find((f) => f.required && !fields[f.id]?.trim());
  if (missingField) throw badRequest(`Fill in "${missingField.label}"`);
  const steps = snap.sop.content.steps.filter((s) => s.kind === 'step');
  const unanswered = steps.findIndex((s) => !results[s.id]?.result);
  if (unanswered >= 0) throw badRequest(`Step ${unanswered + 1} is not checked yet`);
  if (cfg.requireNoteOnFail) {
    const noNote = steps.findIndex((s) => results[s.id]?.result === 'fail' && !results[s.id]?.note.trim());
    if (noNote >= 0) throw badRequest(`Add a note explaining the failure on step ${noNote + 1}`);
  }
  if (cfg.requireSignature && !signature.trim()) throw badRequest('Type your name to sign');
  db.prepare("UPDATE checklist_runs SET status = 'completed', signature = ?, completed_at = ? WHERE id = ?").run(signature.trim().slice(0, 120), nowIso(), r.id);
  // Supervisors and records work in English, whatever language the associate used.
  sopEvents.emitSop('checklistCompleted', getRunById(r.id));
  return getRunByToken(token);
}

export function runAllowsMedia(token: string, mediaId: string): boolean {
  const r = rowByToken(token);
  const snap = JSON.parse(r.snapshot) as RunSnapshot;
  const results = JSON.parse(r.results) as Record<string, CheckItemResult>;
  return referencedMediaIds(snap.sop).includes(mediaId) || Object.values(results).some((x) => x.mediaIds.includes(mediaId));
}

export function listRuns(q: { sopId?: string; status?: string; failed?: boolean; from?: string; to?: string; limit?: number }): ChecklistRunSummary[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.sopId) (where.push('r.sop_id = ?'), params.push(q.sopId));
  if (q.status) (where.push('r.status = ?'), params.push(q.status));
  if (q.failed) where.push('r.fail_count > 0');
  if (q.from) (where.push('r.started_at >= ?'), params.push(q.from));
  if (q.to) (where.push('r.started_at < ?'), params.push(q.to));
  const rows = db.prepare(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.started_at DESC LIMIT ?`).all(...params, q.limit ?? 200) as RunRow[];
  return rows.map(summary);
}

export function deleteRun(id: string) {
  db.prepare('DELETE FROM checklist_runs WHERE id = ?').run(id);
}

export function runsCsv(runs: ChecklistRunSummary[]): string {
  const q = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const fieldKeys = [...new Set(runs.flatMap((r) => r.fieldValues.map((f) => f.label)))];
  const header = ['Started', 'Completed', 'SOP', 'Title', 'Rev', 'Station', 'Performed by', 'Employee ID', 'Status', 'Failed items', ...fieldKeys].map(q).join(',');
  const lines = runs.map((r) =>
    [r.startedAt, r.completedAt ?? '', r.sopNumber, r.sopTitle, r.version, r.stationName ?? '', r.performerName, r.employeeId, r.status, String(r.failCount), ...fieldKeys.map((k) => r.fieldValues.find((f) => f.label === k)?.value ?? '')]
      .map(q)
      .join(','),
  );
  return [header, ...lines].join('\r\n');
}
