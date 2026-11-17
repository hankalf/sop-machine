import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Router } from 'express';
import { requireRole } from '../auth';
import { ensureVariant, getMedia, originalPath, storeFile, type Variant } from '../services/media';
import { badRequest, param } from '../util';
import { upload } from './upload';

export const mediaRouter = Router();

const CACHE = 'private, max-age=31536000, immutable';

mediaRouter.post('/', requireRole('editor'), upload.array('files', 25), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw badRequest('No files received');
  const parentId = typeof req.body?.parentId === 'string' && req.body.parentId ? req.body.parentId : null;
  const out = [];
  try {
    for (const f of files) out.push(await storeFile(f.path, f.originalname, f.mimetype, req.user!.id, parentId));
  } finally {
    await Promise.all(files.map((f) => fsp.rm(f.path, { force: true })));
  }
  res.status(201).json(out);
});

mediaRouter.get('/:id', (req, res) => {
  res.json(getMedia(param(req, 'id')));
});

mediaRouter.get('/:id/file', (req, res) => {
  const m = getMedia(param(req, 'id'));
  const file = originalPath(m.id);
  if (!fs.existsSync(file)) throw badRequest('File is missing from storage');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Disposition', `inline; filename="${m.originalName.replace(/[^\w.\- ]/g, '_')}"`);
  res.type(m.mime);
  res.sendFile(file);
});

mediaRouter.get('/:id/:variant', async (req, res) => {
  const variant = param(req, 'variant');
  if (!['thumb', 'display', 'display-hq', 'poster'].includes(variant)) throw badRequest('Unknown variant');
  const v = await ensureVariant(param(req, 'id'), variant as Variant);
  res.setHeader('Cache-Control', CACHE);
  res.type(v.contentType);
  res.sendFile(v.file);
});
