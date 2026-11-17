import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth';
import { buildContext } from '../render/context';
import { renderHtml } from '../render/html';
import { sampleSop } from '../render/sample';
import { getSettings } from '../services/settings';
import { putPreview, getPreview } from '../services/previewStore';
import { getSop, listRevisions } from '../services/sops';
import { createTemplate, deleteTemplate, getTemplate, listCategories, listTemplates, updateTemplate } from '../services/templates';
import { normalizeDesign } from '../../../shared/defaults';
import { notFound, param, parseBody } from '../util';

export const templatesRouter = Router();

templatesRouter.get('/', (_req, res) => {
  res.json(listTemplates());
});

templatesRouter.post('/', requireRole('admin'), (req, res) => {
  const body = parseBody(
    z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(500).default(''), design: z.unknown().optional(), copyFrom: z.string().optional() }),
    req,
  );
  const design = body.design ?? (body.copyFrom ? getTemplate(body.copyFrom).design : undefined);
  res.status(201).json(createTemplate({ name: body.name, description: body.description, design }));
});

templatesRouter.put('/:id', requireRole('admin'), (req, res) => {
  const body = parseBody(
    z.object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().max(500).optional(), design: z.unknown().optional(), isDefault: z.boolean().optional() }),
    req,
  );
  res.json(updateTemplate(param(req, 'id'), body));
});

templatesRouter.delete('/:id', requireRole('admin'), (req, res) => {
  deleteTemplate(param(req, 'id'));
  res.json({ ok: true });
});

/**
 * Live preview for the Template Designer: renders a sample (or real) SOP with an unsaved design.
 * Optional `settings` lets the admin preview branding/export changes before saving.
 */
templatesRouter.post('/preview', requireRole('editor'), async (req, res) => {
  const body = parseBody(
    z.object({ design: z.unknown(), sopId: z.string().nullable().optional(), mode: z.enum(['paged', 'web']).default('paged'), settings: z.unknown().optional() }),
    req,
  );
  const design = normalizeDesign(body.design);
  const settings = body.settings ? { ...getSettings(), ...(body.settings as object) } : getSettings();
  const purpose = body.mode === 'paged' ? 'preview' : 'view';
  let html: string;
  if (body.sopId) {
    const sop = getSop(body.sopId);
    html = renderHtml(await buildContext(sop, { mode: body.mode, purpose, design, settings, revisions: listRevisions(sop.id) }));
  } else {
    const sample = await sampleSop();
    const category = listCategories().find((c) => c.code === 'TRL') ?? sample.category;
    html = renderHtml(await buildContext(sample.sop, { mode: body.mode, purpose, design, settings, category, revisions: sample.revisions }));
  }
  res.json({ url: `/api/templates/preview/${putPreview(html, req.user!.id)}` });
});

templatesRouter.get('/preview/:token', (req, res) => {
  const html = getPreview(param(req, 'token'), req.user!.id);
  if (!html) throw notFound('Preview expired');
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(html);
});
