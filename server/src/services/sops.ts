import { deepMerge, emptyContent } from '../../../shared/defaults';
import type { Revision, Sop, SopContent, SopSource, SopStatus, SopSummary, SopUpdate, User } from '../../../shared/types';
import { db } from '../db';
import { badRequest, newId, notFound, nowIso } from '../util';
import { getSettings } from './settings';
import { getCategory } from './templates';

interface SopRow {
  id: string;
  number: string;
  title: string;
  category_id: string | null;
  template_id: string | null;
  status: SopStatus;
  version: string;
  owner: string;
  approver: string;
  effective_date: string | null;
  review_date: string | null;
  tags: string;
  content: string;
  source: SopSource;
  published_revision_id: string | null;
  published_version: string | null;
  created_by: string | null;
  updated_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export function normalizeContent(raw: unknown): SopContent {
  const c = deepMerge(emptyContent(), raw);
  c.steps = (c.steps ?? []).map((s) => ({
    id: s.id || newId(),
    kind: s.kind === 'section' ? 'section' : 'step',
    title: s.title ?? '',
    body: s.body ?? '',
    callout: { type: s.callout?.type ?? 'none', text: s.callout?.text ?? '' },
    media: (s.media ?? []).filter((m) => m && m.mediaId).map((m) => ({ mediaId: m.mediaId, caption: m.caption ?? '' })),
  }));
  c.attachments = (c.attachments ?? []).filter((m) => m && m.mediaId);
  c.safety = c.safety.filter((x) => typeof x === 'string' && x.trim());
  c.tools = c.tools.filter((x) => typeof x === 'string' && x.trim());
  return c;
}

function firstImage(content: SopContent): string | null {
  for (const s of content.steps) for (const m of s.media) return m.mediaId;
  return content.attachments[0]?.mediaId ?? null;
}

function toSop(r: SopRow): Sop {
  const content = normalizeContent(JSON.parse(r.content));
  return {
    id: r.id,
    number: r.number,
    title: r.title,
    categoryId: r.category_id,
    templateId: r.template_id,
    status: r.status,
    version: r.version,
    owner: r.owner,
    approver: r.approver,
    effectiveDate: r.effective_date,
    reviewDate: r.review_date,
    tags: JSON.parse(r.tags),
    content,
    source: r.source,
    coverMediaId: firstImage(content),
    stepCount: content.steps.filter((s) => s.kind === 'step').length,
    publishedVersion: r.published_version,
    publishedRevisionId: r.published_revision_id,
    createdBy: r.created_by,
    updatedBy: r.updated_by,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function summarize(s: Sop): SopSummary {
  return {
    id: s.id,
    number: s.number,
    title: s.title,
    categoryId: s.categoryId,
    templateId: s.templateId,
    status: s.status,
    version: s.version,
    owner: s.owner,
    source: s.source,
    tags: s.tags,
    coverMediaId: s.coverMediaId,
    stepCount: s.stepCount,
    publishedVersion: s.publishedVersion,
    reviewDate: s.reviewDate,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function searchText(s: { number: string; title: string; owner: string; tags: string[]; content: SopContent }): string {
  const c = s.content;
  return [
    s.number,
    s.title,
    s.owner,
    ...s.tags,
    c.purpose,
    c.scope,
    c.responsibilities,
    ...c.safety,
    ...c.tools,
    c.notes,
    ...c.steps.flatMap((st) => [st.title, st.body, st.callout.text, ...st.media.map((m) => m.caption)]),
  ]
    .join('\n')
    .toLowerCase();
}

export function getSop(id: string): Sop {
  const r = db.prepare('SELECT * FROM sops WHERE id = ?').get(id) as SopRow | undefined;
  if (!r) throw notFound('SOP not found');
  return toSop(r);
}

/**
 * Viewers only ever see the last approved revision.
 * Editors/admins see the working copy.
 */
export function getSopForUser(id: string, user: User): Sop {
  const sop = getSop(id);
  if (user.role !== 'viewer') return sop;
  if (sop.status === 'approved') return sop;
  if (!sop.publishedRevisionId) throw notFound('SOP not found');
  return getRevisionSnapshot(sop.publishedRevisionId);
}

export function listSops(user: User, q: { search?: string; categoryId?: string; status?: string }): SopSummary[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.search) {
    for (const term of q.search.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)) {
      where.push('search_text LIKE ?');
      params.push(`%${term.replace(/[%_]/g, '')}%`);
    }
  }
  if (q.categoryId) {
    where.push('category_id = ?');
    params.push(q.categoryId);
  }
  if (q.status) {
    where.push('status = ?');
    params.push(q.status);
  }
  if (user.role === 'viewer') where.push('published_revision_id IS NOT NULL');
  const sql = `SELECT * FROM sops ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT 500`;
  const rows = db.prepare(sql).all(...params) as SopRow[];
  return rows.map((r) => {
    const s = toSop(r);
    if (user.role === 'viewer' && s.status !== 'approved' && s.publishedRevisionId) {
      return summarize(getRevisionSnapshot(s.publishedRevisionId));
    }
    return summarize(s);
  });
}

export function nextNumber(categoryId: string | null): string {
  const settings = getSettings();
  const cat = getCategory(categoryId);
  const base = [settings.numbering.prefix, cat?.code].filter(Boolean).join('-');
  const prefix = base ? `${base}-` : '';
  const rows = db.prepare('SELECT number FROM sops WHERE number LIKE ?').all(`${prefix}%`) as { number: string }[];
  let max = 0;
  for (const r of rows) {
    const rest = r.number.slice(prefix.length);
    if (/^\d+$/.test(rest)) max = Math.max(max, Number(rest));
  }
  return `${prefix}${String(max + 1).padStart(settings.numbering.digits, '0')}`;
}

export function numberInUse(number: string): boolean {
  return !!db.prepare('SELECT 1 FROM sops WHERE number = ?').get(number);
}

export function createSop(
  input: {
    title: string;
    categoryId: string | null;
    templateId?: string | null;
    content?: SopContent;
    source?: SopSource;
    owner?: string;
    approver?: string;
    tags?: string[];
    /** Keep an imported SOP's original number/revision when they are free to use. */
    number?: string;
    version?: string;
  },
  user: User,
): Sop {
  const id = newId();
  const now = nowIso();
  const content = normalizeContent(input.content ?? emptyContent());
  const wanted = input.number?.trim();
  const number = wanted && !numberInUse(wanted) ? wanted.slice(0, 60) : nextNumber(input.categoryId);
  const version = input.version?.trim().slice(0, 20) || '1.0';
  const tags = input.tags ?? [];
  const owner = input.owner ?? user.name;
  db.prepare(
    `INSERT INTO sops (id, number, title, category_id, template_id, status, version, owner, approver, tags, content, search_text, source, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    number,
    input.title,
    input.categoryId,
    input.templateId ?? null,
    version,
    owner,
    input.approver ?? '',
    JSON.stringify(tags),
    JSON.stringify(content),
    searchText({ number, title: input.title, owner, tags, content }),
    input.source ?? 'manual',
    user.id,
    user.id,
    now,
    now,
  );
  return getSop(id);
}

function bumpMinor(version: string): string {
  const m = /^(\d+)\.(\d+)$/.exec(version.trim());
  if (!m) return version;
  return `${m[1]}.${Number(m[2]) + 1}`;
}

export function updateSop(id: string, patch: SopUpdate, user: User): Sop {
  const current = getSop(id);
  if (current.status === 'archived') throw badRequest('Archived SOPs are read-only. Restore it to draft first.');
  const next = {
    number: patch.number?.trim() || current.number,
    title: patch.title?.trim() || current.title,
    categoryId: patch.categoryId !== undefined ? patch.categoryId : current.categoryId,
    templateId: patch.templateId !== undefined ? patch.templateId : current.templateId,
    owner: patch.owner ?? current.owner,
    approver: patch.approver ?? current.approver,
    effectiveDate: patch.effectiveDate !== undefined ? patch.effectiveDate : current.effectiveDate,
    reviewDate: patch.reviewDate !== undefined ? patch.reviewDate : current.reviewDate,
    tags: patch.tags ?? current.tags,
    content: patch.content ? normalizeContent(patch.content) : current.content,
  };
  // Editing an approved SOP starts a new draft revision; the approved copy stays published.
  let status = current.status;
  let version = current.version;
  if (current.status === 'approved') {
    status = 'draft';
    version = bumpMinor(current.version);
  }
  db.prepare(
    `UPDATE sops SET number=?, title=?, category_id=?, template_id=?, owner=?, approver=?, effective_date=?, review_date=?, tags=?, content=?,
       search_text=?, status=?, version=?, updated_by=?, updated_at=? WHERE id=?`,
  ).run(
    next.number,
    next.title,
    next.categoryId,
    next.templateId,
    next.owner,
    next.approver,
    next.effectiveDate,
    next.reviewDate,
    JSON.stringify(next.tags),
    JSON.stringify(next.content),
    searchText(next),
    status,
    version,
    user.id,
    nowIso(),
    id,
  );
  return getSop(id);
}

export function changeStatus(
  id: string,
  input: { status: SopStatus; summary?: string; version?: string },
  user: User,
): Sop {
  const sop = getSop(id);
  const settings = getSettings();
  const now = nowIso();
  if (input.status === 'approved') {
    if (settings.workflow.requireApproval && user.role !== 'admin') {
      throw badRequest('Only an administrator can approve SOPs. Submit it for review instead.');
    }
    const version = input.version?.trim() || sop.version;
    const today = now.slice(0, 10);
    let reviewDate = sop.reviewDate;
    if (settings.workflow.reviewIntervalMonths > 0) {
      const d = new Date();
      d.setMonth(d.getMonth() + settings.workflow.reviewIntervalMonths);
      reviewDate = d.toISOString().slice(0, 10);
    }
    const approver = sop.approver || user.name;
    const revisionId = newId();
    db.transaction(() => {
      db.prepare(
        `UPDATE sops SET status='approved', version=?, approver=?, effective_date=?, review_date=?, approved_by=?, approved_at=?,
           published_revision_id=?, published_version=?, updated_at=? WHERE id=?`,
      ).run(version, approver, today, reviewDate, user.id, now, revisionId, version, now, id);
      const snapshot = getSop(id);
      db.prepare('INSERT INTO revisions (id, sop_id, version, summary, snapshot, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        revisionId,
        id,
        version,
        input.summary?.trim() || (sop.publishedVersion ? 'Revised' : 'Initial release'),
        JSON.stringify(snapshot),
        user.id,
        now,
      );
    })();
    return getSop(id);
  }
  db.prepare('UPDATE sops SET status = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(input.status, user.id, now, id);
  return getSop(id);
}

export function listRevisions(sopId: string): Revision[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.sop_id, r.version, r.summary, r.created_at, u.name AS user_name
       FROM revisions r LEFT JOIN users u ON u.id = r.created_by WHERE r.sop_id = ? ORDER BY r.created_at DESC`,
    )
    .all(sopId) as { id: string; sop_id: string; version: string; summary: string; created_at: string; user_name: string | null }[];
  return rows.map((r) => ({
    id: r.id,
    sopId: r.sop_id,
    version: r.version,
    summary: r.summary,
    createdByName: r.user_name,
    createdAt: r.created_at,
  }));
}

export function getRevisionSnapshot(revisionId: string): Sop {
  const r = db.prepare('SELECT snapshot FROM revisions WHERE id = ?').get(revisionId) as { snapshot: string } | undefined;
  if (!r) throw notFound('Revision not found');
  const snap = JSON.parse(r.snapshot) as Sop;
  snap.content = normalizeContent(snap.content);
  return snap;
}

export function duplicateSop(id: string, user: User): Sop {
  const src = getSop(id);
  const content = normalizeContent(JSON.parse(JSON.stringify(src.content)));
  content.steps = content.steps.map((s) => ({ ...s, id: newId() }));
  return createSop(
    { title: `${src.title} (copy)`, categoryId: src.categoryId, templateId: src.templateId, content, tags: src.tags, owner: src.owner },
    user,
  );
}

export function deleteSop(id: string) {
  db.prepare('DELETE FROM sops WHERE id = ?').run(id);
}

export function userName(id: string | null): string {
  if (!id) return '';
  const r = db.prepare('SELECT name FROM users WHERE id = ?').get(id) as { name: string } | undefined;
  return r?.name ?? '';
}
