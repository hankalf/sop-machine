import crypto from 'node:crypto';
import { DOC_STRINGS } from '../../../shared/defaults';
import type { Sop, SopTranslation, TemplateDesign, TranslatedContent } from '../../../shared/types';
import { db } from '../db';
import { newId, notFound, nowIso } from '../util';
import { getCategory, resolveTemplate } from './templates';

interface TRow {
  id: string;
  sop_id: string;
  language: string;
  title: string;
  content: string;
  strings: string;
  source_hash: string;
  source_version: string;
  status: 'machine' | 'reviewed';
  updated_by: string | null;
  updated_at: string;
  user_name?: string | null;
}

/** The English text of an SOP, in the shape translations use. */
export function sourceContent(sop: Sop): TranslatedContent {
  const c = sop.content;
  return {
    title: sop.title,
    purpose: c.purpose,
    scope: c.scope,
    responsibilities: c.responsibilities,
    notes: c.notes,
    safety: [...c.safety],
    tools: [...c.tools],
    steps: c.steps.map((s) => ({ id: s.id, title: s.title, body: s.body, callout: s.callout.type === 'none' ? '' : s.callout.text, captions: s.media.map((m) => m.caption) })),
    attachments: c.attachments.map((a) => a.caption),
    checklistFields: c.checklist.fields.map((f) => f.label),
    quiz: c.quiz.questions.map((q) => ({ question: q.question, options: [...q.options], explanation: q.explanation })),
  };
}

/** Fixed document wording plus the template's own labels. */
export function sourceStrings(design: TemplateDesign): Record<string, string> {
  const out: Record<string, string> = { ...DOC_STRINGS };
  for (const s of design.sections) out[`section.${s.key}`] = s.label;
  out['cover.subtitle'] = design.cover.subtitle;
  out['footer.left'] = design.footer.left;
  out['footer.center'] = design.footer.center;
  return out;
}

export function designFor(sop: Sop): TemplateDesign {
  return resolveTemplate(sop.templateId, getCategory(sop.categoryId)).design;
}

export function contentHash(sop: Sop): string {
  // SOPs without quiz questions hash exactly as they did before quizzes existed,
  // so translations made earlier stay valid.
  const { quiz, ...rest } = sourceContent(sop);
  return crypto.createHash('sha1').update(JSON.stringify(quiz.length ? { ...rest, quiz } : rest)).digest('hex').slice(0, 20);
}

function toTranslation(r: TRow, currentHash: string | null): SopTranslation {
  const content = JSON.parse(r.content) as TranslatedContent;
  content.quiz ??= [];
  return {
    id: r.id,
    sopId: r.sop_id,
    language: r.language,
    content,
    strings: JSON.parse(r.strings),
    sourceVersion: r.source_version,
    status: r.status,
    outdated: currentHash !== null && r.source_hash !== currentHash,
    updatedAt: r.updated_at,
    updatedByName: r.user_name ?? null,
  };
}

const SELECT = `SELECT t.*, u.name AS user_name FROM translations t LEFT JOIN users u ON u.id = t.updated_by`;

/** Latest translation per language, flagged when the SOP text has changed since. */
export function listTranslations(sop: Sop): SopTranslation[] {
  const rows = db.prepare(`${SELECT} WHERE t.sop_id = ? ORDER BY t.updated_at DESC`).all(sop.id) as TRow[];
  const hash = contentHash(sop);
  const seen = new Set<string>();
  const out: SopTranslation[] = [];
  for (const r of rows) {
    if (seen.has(r.language)) continue;
    seen.add(r.language);
    // Prefer the exact match for this content if there is one.
    const exact = rows.find((x) => x.language === r.language && x.source_hash === hash);
    out.push(toTranslation(exact ?? r, hash));
  }
  return out;
}

/**
 * Translation to render for this exact SOP content.
 * 'exact' (viewers, stations, binders): only a translation made from this text.
 * 'latest' (editors): the newest one, even if the English has changed since.
 */
export function translationFor(sop: Sop, language: string, policy: 'exact' | 'latest'): SopTranslation | null {
  if (!language || language === 'en') return null;
  const hash = contentHash(sop);
  const exact = db.prepare(`${SELECT} WHERE t.sop_id = ? AND t.language = ? AND t.source_hash = ?`).get(sop.id, language, hash) as TRow | undefined;
  if (exact) return toTranslation(exact, hash);
  if (policy === 'exact') return null;
  const latest = db.prepare(`${SELECT} WHERE t.sop_id = ? AND t.language = ? ORDER BY t.updated_at DESC LIMIT 1`).get(sop.id, language) as TRow | undefined;
  return latest ? toTranslation(latest, hash) : null;
}

/** Languages with a translation that exactly matches this content. */
export function exactLanguages(sop: Sop): string[] {
  const rows = db.prepare('SELECT language FROM translations WHERE sop_id = ? AND source_hash = ?').all(sop.id, contentHash(sop)) as { language: string }[];
  return rows.map((r) => r.language);
}

export function saveTranslation(sop: Sop, language: string, content: TranslatedContent, strings: Record<string, string>, userId: string | null): SopTranslation {
  const hash = contentHash(sop);
  const now = nowIso();
  db.prepare(
    `INSERT INTO translations (id, sop_id, language, title, content, strings, source_hash, source_version, status, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'machine', ?, ?)
     ON CONFLICT (sop_id, language, source_hash) DO UPDATE SET title = excluded.title, content = excluded.content, strings = excluded.strings,
       status = 'machine', updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).run(newId(), sop.id, language, content.title, JSON.stringify(content), JSON.stringify(strings), hash, sop.version, userId, now);
  return translationFor(sop, language, 'exact')!;
}

/** Human edits to a translation (from the side-by-side editor). */
export function updateTranslation(
  sop: Sop,
  language: string,
  patch: { content: TranslatedContent; strings?: Record<string, string>; reviewed: boolean },
  userId: string,
): SopTranslation {
  const current = translationFor(sop, language, 'latest');
  if (!current) throw notFound('Translation not found');
  const hash = contentHash(sop);
  const strings = { ...current.strings, ...(patch.strings ?? {}) };
  const now = nowIso();
  // Saving against the current text makes the translation up to date again.
  db.prepare(
    `INSERT INTO translations (id, sop_id, language, title, content, strings, source_hash, source_version, status, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (sop_id, language, source_hash) DO UPDATE SET title = excluded.title, content = excluded.content, strings = excluded.strings,
       status = excluded.status, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).run(newId(), sop.id, language, patch.content.title, JSON.stringify(patch.content), JSON.stringify(strings), hash, sop.version, patch.reviewed ? 'reviewed' : 'machine', userId, now);
  return translationFor(sop, language, 'exact')!;
}

export function deleteTranslations(sopId: string, language: string) {
  db.prepare('DELETE FROM translations WHERE sop_id = ? AND language = ?').run(sopId, language);
}

/** Line up an AI translation with the source (same step ids and list lengths). */
export function alignTranslation(source: TranslatedContent, tr: Partial<TranslatedContent>): TranslatedContent {
  const arr = (a: unknown, n: number) => Array.from({ length: n }, (_, i) => (Array.isArray(a) && typeof a[i] === 'string' ? (a[i] as string) : ''));
  const steps = source.steps.map((s, i) => {
    const t = tr.steps?.find((x) => x.id === s.id) ?? tr.steps?.[i];
    return {
      id: s.id,
      title: t?.title ?? '',
      body: t?.body ?? '',
      callout: s.callout ? (t?.callout ?? '') : '',
      captions: arr(t?.captions, s.captions.length),
    };
  });
  return {
    title: tr.title ?? '',
    purpose: tr.purpose ?? '',
    scope: tr.scope ?? '',
    responsibilities: tr.responsibilities ?? '',
    notes: tr.notes ?? '',
    safety: arr(tr.safety, source.safety.length),
    tools: arr(tr.tools, source.tools.length),
    steps,
    attachments: arr(tr.attachments, source.attachments.length),
    checklistFields: arr(tr.checklistFields, source.checklistFields.length),
    quiz: source.quiz.map((q, i) => ({
      question: tr.quiz?.[i]?.question ?? '',
      options: arr(tr.quiz?.[i]?.options, q.options.length),
      explanation: q.explanation ? (tr.quiz?.[i]?.explanation ?? '') : '',
    })),
  };
}
