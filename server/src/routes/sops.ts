import { Router } from 'express';
import { z } from 'zod';
import { hasRole, requireRole } from '../auth';
import { buildContext } from '../render/context';
import { contentDisposition, exportSop } from '../render/export';
import { renderHtml } from '../render/html';
import { getSettings } from '../services/settings';
import {
  changeStatus,
  createSop,
  deleteSop,
  duplicateSop,
  getRevisionSnapshot,
  getSop,
  getSopForUser,
  listRevisions,
  listSops,
  updateSop,
} from '../services/sops';
import { LANGUAGES } from '../../../shared/defaults';
import type { Sop, User } from '../../../shared/types';
import { sopPlacard, type PlacardSize } from '../render/placard';
import { createJob } from '../services/generator';
import { startRun } from '../services/runs';
import { getStation, stationsForSop } from '../services/stations';
import { acknowledge, listAcknowledgments, myAcknowledgment } from '../services/training';
import { deleteTranslations, exactLanguages, listTranslations, sourceContent, sourceStrings, designFor, translationFor, updateTranslation } from '../services/translations';
import { quizActive } from '../../../shared/defaults';
import { suggestQuiz } from '../services/ai';
import { publicQuestions } from '../services/quiz';
import { getSettings as settingsNow } from '../services/settings';
import { recordView } from '../services/views';
import { badRequest, forbidden, newId, param, parseBody } from '../util';

export const sopsRouter = Router();

const stepMedia = z.object({ mediaId: z.string(), caption: z.string().max(500) });
const content = z.object({
  checklist: z
    .object({
      enabled: z.boolean(),
      style: z.enum(['check', 'passfail']),
      fields: z.array(z.object({ id: z.string().max(40), label: z.string().max(80), required: z.boolean() })).max(20),
      requireSignature: z.boolean(),
      requireNoteOnFail: z.boolean(),
    })
    .default({ enabled: false, style: 'passfail', fields: [], requireSignature: true, requireNoteOnFail: true }),
  quiz: z
    .object({
      enabled: z.boolean(),
      questions: z
        .array(z.object({ id: z.string().max(40), question: z.string().max(500), options: z.array(z.string().max(300)).max(5), correctIndex: z.number().int(), explanation: z.string().max(500) }))
        .max(10),
    })
    .default({ enabled: false, questions: [] }),
  purpose: z.string().max(20000),
  scope: z.string().max(20000),
  responsibilities: z.string().max(20000),
  safety: z.array(z.string().max(500)).max(100),
  tools: z.array(z.string().max(500)).max(100),
  notes: z.string().max(20000),
  attachments: z.array(stepMedia).max(50),
  steps: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(['step', 'section']),
        title: z.string().max(300),
        body: z.string().max(20000),
        callout: z.object({ type: z.enum(['none', 'danger', 'warning', 'caution', 'note', 'tip']), text: z.string().max(5000) }),
        media: z.array(stepMedia).max(20),
      }),
    )
    .max(500),
});

sopsRouter.get('/', (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json(listSops(req.user!, { search: q.search, categoryId: q.categoryId, status: q.status }));
});

sopsRouter.post('/', requireRole('editor'), (req, res) => {
  const body = parseBody(
    z.object({ title: z.string().trim().min(1).max(300), categoryId: z.string().nullable(), templateId: z.string().nullable().optional() }),
    req,
  );
  res.status(201).json(createSop(body, req.user!));
});

sopsRouter.get('/:id', (req, res) => {
  res.json(getSopForUser(param(req, 'id'), req.user!));
});

sopsRouter.put('/:id', requireRole('editor'), (req, res) => {
  const body = parseBody(
    z.object({
      number: z.string().trim().max(60).optional(),
      title: z.string().trim().max(300).optional(),
      categoryId: z.string().nullable().optional(),
      templateId: z.string().nullable().optional(),
      owner: z.string().max(200).optional(),
      approver: z.string().max(200).optional(),
      ownerUserId: z.string().nullable().optional(),
      effectiveDate: z.string().nullable().optional(),
      reviewDate: z.string().nullable().optional(),
      tags: z.array(z.string().max(60)).max(30).optional(),
      content: content.optional(),
    }),
    req,
  );
  res.json(updateSop(param(req, 'id'), body, req.user!));
});

sopsRouter.delete('/:id', requireRole('admin'), (req, res) => {
  deleteSop(param(req, 'id'));
  res.json({ ok: true });
});

sopsRouter.post('/:id/duplicate', requireRole('editor'), (req, res) => {
  res.status(201).json(duplicateSop(param(req, 'id'), req.user!));
});

sopsRouter.post('/:id/status', requireRole('editor'), (req, res) => {
  const body = parseBody(
    z.object({ status: z.enum(['draft', 'review', 'approved', 'archived']), summary: z.string().max(1000).optional(), version: z.string().max(20).optional() }),
    req,
  );
  res.json(changeStatus(param(req, 'id'), body, req.user!));
});

sopsRouter.get('/:id/revisions', (req, res) => {
  getSopForUser(param(req, 'id'), req.user!);
  res.json(listRevisions(param(req, 'id')));
});

/** Viewers only see translations made from the exact published text; editors see the latest. */
function langFor(req: { query: Record<string, unknown> }, sop: Sop, user: User) {
  const code = typeof req.query.lang === 'string' && req.query.lang !== 'en' ? req.query.lang : null;
  const translation = code ? translationFor(sop, code, user.role === 'viewer' ? 'exact' : 'latest') : null;
  return { code: translation ? code! : 'en', translation, bilingual: req.query.bi === '1' };
}

/** Rendered HTML for the in-app viewer (web) and print preview (paged). */
sopsRouter.get('/:id/render', async (req, res) => {
  const sop = getSopForUser(param(req, 'id'), req.user!);
  const mode = req.query.mode === 'paged' ? 'paged' : 'web';
  const l = langFor(req, sop, req.user!);
  const ctx = await buildContext(sop, { mode, purpose: mode === 'paged' ? 'preview' : 'view', language: l.code, bilingual: l.bilingual, translation: l.translation });
  // The SOP page asks to be counted; editor previews don't.
  if (req.query.track === '1') recordView(sop.id, `u:${req.user!.id}`, req.user!.role === 'viewer');
  res.type('html').send(renderHtml(ctx));
});

// ---- Languages & translations ----

/** Languages a user can switch this SOP to. */
sopsRouter.get('/:id/languages', (req, res) => {
  const sop = getSopForUser(param(req, 'id'), req.user!);
  const codes = req.user!.role === 'viewer' ? exactLanguages(sop) : listTranslations(sop).map((t) => t.language);
  res.json(LANGUAGES.filter((l) => codes.includes(l.code)));
});

sopsRouter.get('/:id/translations', requireRole('editor'), (req, res) => {
  res.json(listTranslations(getSop(param(req, 'id'))));
});

sopsRouter.post('/:id/translations', requireRole('editor'), (req, res) => {
  const body = parseBody(z.object({ language: z.string().min(2).max(8) }), req);
  const sop = getSop(param(req, 'id'));
  if (!LANGUAGES.some((l) => l.code === body.language)) throw badRequest('Unsupported language');
  const name = LANGUAGES.find((l) => l.code === body.language)!.name;
  res.status(201).json(createJob('translate', `${name}: ${sop.number} ${sop.title}`, { sopId: sop.id, language: body.language }, req.user!));
});

/** Source and translation side by side for the translation editor. */
sopsRouter.get('/:id/translations/:lang', requireRole('editor'), (req, res) => {
  const sop = getSop(param(req, 'id'));
  const t = translationFor(sop, param(req, 'lang'), 'latest');
  if (!t) throw badRequest('No translation yet');
  res.json({ source: { content: sourceContent(sop), strings: sourceStrings(designFor(sop)) }, translation: t });
});

const translatedContent = z.object({
  title: z.string().max(300),
  purpose: z.string().max(20000),
  scope: z.string().max(20000),
  responsibilities: z.string().max(20000),
  notes: z.string().max(20000),
  safety: z.array(z.string().max(500)),
  tools: z.array(z.string().max(500)),
  steps: z.array(z.object({ id: z.string(), title: z.string().max(300), body: z.string().max(20000), callout: z.string().max(5000), captions: z.array(z.string().max(500)) })),
  attachments: z.array(z.string().max(500)),
  checklistFields: z.array(z.string().max(80)),
  quiz: z.array(z.object({ question: z.string().max(500), options: z.array(z.string().max(300)), explanation: z.string().max(500) })).default([]),
});

sopsRouter.put('/:id/translations/:lang', requireRole('editor'), (req, res) => {
  const body = parseBody(z.object({ content: translatedContent, strings: z.record(z.string(), z.string().max(500)).optional(), reviewed: z.boolean().default(true) }), req);
  res.json(updateTranslation(getSop(param(req, 'id')), param(req, 'lang'), body, req.user!.id));
});

sopsRouter.delete('/:id/translations/:lang', requireRole('editor'), (req, res) => {
  deleteTranslations(param(req, 'id'), param(req, 'lang'));
  res.json({ ok: true });
});

// ---- Training sign-off ----

sopsRouter.get('/:id/acknowledgments', (req, res) => {
  const sop = getSopForUser(param(req, 'id'), req.user!);
  if (req.user!.role === 'viewer') return void res.json({ mine: myAcknowledgment(sop, req.user!), all: [] });
  res.json({ mine: myAcknowledgment(sop, req.user!), all: listAcknowledgments(getSop(sop.id)) });
});

/** Quiz questions (without answers) for the version this user would sign. */
sopsRouter.get('/:id/quiz', (req, res) => {
  const sop = getSopForUser(param(req, 'id'), req.user!);
  const published = sop.status === 'approved' ? sop : sop.publishedRevisionId ? getRevisionSnapshot(sop.publishedRevisionId) : null;
  if (!published || !quizActive(published.content)) return void res.json({ questions: [] });
  const lang = typeof req.query.lang === 'string' ? req.query.lang : 'en';
  res.json({ questions: publicQuestions(published, translationFor(published, lang, 'exact')) });
});

sopsRouter.post('/:id/acknowledge', (req, res) => {
  const body = parseBody(z.object({ answers: z.record(z.string(), z.number().int()).default({}), language: z.string().max(8).default('en') }), req);
  const sop = getSopForUser(param(req, 'id'), req.user!);
  res.json(acknowledge(sop.id, { userId: req.user!.id, name: req.user!.name }, { method: 'app', answers: body.answers, language: body.language }));
});

/** Draft quiz questions from the SOP text. The editor reviews them before saving. */
sopsRouter.post('/:id/quiz/suggest', requireRole('editor'), async (req, res) => {
  const body = parseBody(z.object({ count: z.number().int().min(1).max(8).default(3) }), req);
  const sop = getSop(param(req, 'id'));
  const questions = await suggestQuiz(settingsNow(), sourceContent(sop), body.count);
  res.json(questions.map((q) => ({ id: newId(), ...q })));
});

/** A supervisor records training for associates (e.g. after a toolbox talk). */
sopsRouter.post('/:id/acknowledgments', requireRole('editor'), (req, res) => {
  const body = parseBody(
    z.object({
      people: z.array(z.object({ name: z.string().trim().min(1).max(120), employeeId: z.string().trim().max(60).default('') })).min(1).max(200),
      note: z.string().max(500).default(''),
    }),
    req,
  );
  let created = 0;
  for (const p of body.people) {
    if (acknowledge(param(req, 'id'), p, { method: 'recorded', recordedBy: req.user!.id, note: body.note }).created) created++;
  }
  res.json({ created });
});

// ---- Stations & placards ----

sopsRouter.get('/:id/stations', requireRole('editor'), (req, res) => {
  res.json(stationsForSop(param(req, 'id')));
});

sopsRouter.get('/:id/placard', requireRole('editor'), async (req, res) => {
  const sop = getSop(param(req, 'id'));
  const station = typeof req.query.stationId === 'string' && req.query.stationId ? getStation(req.query.stationId) : null;
  const size: PlacardSize = req.query.size === 'half' || req.query.size === 'card' ? req.query.size : 'letter';
  const pdf = await sopPlacard(sop, station, size);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', contentDisposition(`QR placard - ${sop.number}.pdf`));
  res.send(pdf);
});

// ---- Checklists ----

sopsRouter.post('/:id/runs', (req, res) => {
  const body = parseBody(z.object({ language: z.string().max(8).default('en'), fields: z.record(z.string(), z.string()).default({}) }), req);
  const run = startRun({ sopId: param(req, 'id'), user: req.user!, name: req.user!.name, employeeId: '', stationId: null, language: body.language, fields: body.fields });
  res.status(201).json(run);
});

function canExport(role: string) {
  return role !== 'viewer' || getSettings().export.allowViewerExport;
}

sopsRouter.get('/:id/export', async (req, res) => {
  if (!canExport(req.user!.role)) throw forbidden('Exporting is turned off for viewers');
  const format = req.query.format === 'docx' ? 'docx' : 'pdf';
  const sop = getSopForUser(param(req, 'id'), req.user!);
  const l = langFor(req, sop, req.user!);
  const file = await exportSop(sop, format, { translation: l.translation, bilingual: l.bilingual });
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', contentDisposition(file.filename, req.query.inline === '1'));
  res.send(file.data);
});

sopsRouter.get('/:id/revisions/:revisionId/export', async (req, res) => {
  if (!hasRole(req.user, 'editor')) throw forbidden();
  getSop(param(req, 'id'));
  const snapshot = getRevisionSnapshot(param(req, 'revisionId'));
  if (snapshot.id !== param(req, 'id')) throw forbidden();
  const file = await exportSop(snapshot, req.query.format === 'docx' ? 'docx' : 'pdf');
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', contentDisposition(file.filename));
  res.send(file.data);
});
