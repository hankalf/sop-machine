import fsp from 'node:fs/promises';
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth';
import { ensureVariant, getMedia, originalInfo, setMarkup, storeFile, type Variant } from '../services/media';
import { sendOriginal } from '../services/storage';
import { badRequest, param } from '../util';
import { upload } from './upload';

export const mediaRouter = Router();

const CACHE = 'private, max-age=31536000, immutable';

// Shapes may sit slightly off the image while being dragged; anything wilder is rejected.
const coord = z.number().min(-0.5).max(1.5);
const markupSchema = z.object({
  v: z.literal(1),
  baseId: z.string().min(1).max(64),
  shapes: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        tool: z.enum(['rect', 'ellipse', 'arrow', 'line', 'pen', 'highlight', 'marker', 'text', 'note', 'redact']),
        x1: coord,
        y1: coord,
        x2: coord,
        y2: coord,
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        size: z.enum(['s', 'm', 'l']),
        text: z.string().max(2000).optional(),
        n: z.number().int().min(1).max(999).optional(),
        points: z.array(z.tuple([coord, coord])).max(4000).optional(),
        pointer: z.boolean().optional(),
      }),
    )
    .max(400),
});

mediaRouter.post('/', requireRole('editor'), upload.array('files', 25), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw badRequest('No files received');
  const parentId = typeof req.body?.parentId === 'string' && req.body.parentId ? req.body.parentId : null;
  let markup: z.infer<typeof markupSchema> | null = null;
  if (typeof req.body?.markup === 'string' && req.body.markup) {
    let raw: unknown;
    try {
      raw = JSON.parse(req.body.markup);
    } catch {
      throw badRequest('Markup is not valid JSON');
    }
    const parsed = markupSchema.safeParse(raw);
    if (!parsed.success) throw badRequest('Markup could not be read');
    if (getMedia(parsed.data.baseId).kind !== 'image') throw badRequest('Markup must be drawn on an image');
    markup = parsed.data;
  }
  const out = [];
  try {
    for (const f of files) {
      const item = await storeFile(f.path, f.originalname, f.mimetype, req.user!.id, parentId);
      if (markup && item.kind === 'image') {
        setMarkup(item.id, markup);
        out.push(getMedia(item.id));
      } else out.push(item);
    }
  } finally {
    await Promise.all(files.map((f) => fsp.rm(f.path, { force: true })));
  }
  res.status(201).json(out);
});

mediaRouter.get('/:id', (req, res) => {
  res.json(getMedia(param(req, 'id')));
});

mediaRouter.get('/:id/file', async (req, res) => {
  const m = getMedia(param(req, 'id'));
  const o = originalInfo(m.id);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Disposition', `inline; filename="${m.originalName.replace(/[^\w.\- ]/g, '_')}"`);
  await sendOriginal(req, res, o.file, o.location, o.mime);
});

mediaRouter.get('/:id/:variant', async (req, res) => {
  const variant = param(req, 'variant');
  if (!['thumb', 'display', 'display-hq', 'poster'].includes(variant)) throw badRequest('Unknown variant');
  const v = await ensureVariant(param(req, 'id'), variant as Variant);
  res.setHeader('Cache-Control', CACHE);
  res.type(v.contentType);
  res.sendFile(v.file);
});
