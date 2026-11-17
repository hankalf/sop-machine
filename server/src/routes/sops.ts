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
import { forbidden, param, parseBody } from '../util';

export const sopsRouter = Router();

const stepMedia = z.object({ mediaId: z.string(), caption: z.string().max(500) });
const content = z.object({
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

/** Rendered HTML for the in-app viewer (web) and print preview (paged). */
sopsRouter.get('/:id/render', async (req, res) => {
  const sop = getSopForUser(param(req, 'id'), req.user!);
  const mode = req.query.mode === 'paged' ? 'paged' : 'web';
  const ctx = await buildContext(sop, { mode, purpose: mode === 'paged' ? 'preview' : 'view' });
  res.type('html').send(renderHtml(ctx));
});

function canExport(role: string) {
  return role !== 'viewer' || getSettings().export.allowViewerExport;
}

sopsRouter.get('/:id/export', async (req, res) => {
  if (!canExport(req.user!.role)) throw forbidden('Exporting is turned off for viewers');
  const format = req.query.format === 'docx' ? 'docx' : 'pdf';
  const sop = getSopForUser(param(req, 'id'), req.user!);
  const file = await exportSop(sop, format);
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
