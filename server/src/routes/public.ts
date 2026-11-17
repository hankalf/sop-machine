import fsp from 'node:fs/promises';
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { LANGUAGES } from '../../../shared/defaults';
import type { PublicStationView } from '../../../shared/types';
import { userFromRequest } from '../auth';
import { buildContext } from '../render/context';
import { renderHtml } from '../render/html';
import { ensureVariant, getMedia, originalInfo, storeFile, type Variant } from '../services/media';
import { completeRun, getRunByToken, runAllowsMedia, startRun, updateRun } from '../services/runs';
import { publicBranding, getSettings } from '../services/settings';
import { stationAllowsMedia, stationByToken, stationSop, stationSops, summarizeForStation } from '../services/stations';
import { sendOriginal } from '../services/storage';
import { acknowledge } from '../services/training';
import { translationFor } from '../services/translations';
import { HttpError, badRequest, param, parseBody } from '../util';
import { upload } from './upload';

/** Station QR pages and checklist runs. Open to anyone with the link when the station allows it. */
export const publicRouter = Router();

const writeLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

function station(req: Request) {
  const s = stationByToken(param(req, 'token'));
  const user = userFromRequest(req);
  if (!s.publicAccess && !user) throw Object.assign(new HttpError(401, 'Please sign in to view this station'), { loginRequired: true });
  return { s, user };
}

publicRouter.get('/stations/:token', (req, res) => {
  const { s, user } = station(req);
  const settings = getSettings();
  const view: PublicStationView = {
    station: { id: s.id, name: s.name, area: s.area, publicAccess: s.publicAccess },
    branding: publicBranding(),
    sops: stationSops(s).map(summarizeForStation),
    trainingEnabled: settings.training.enabled,
    languages: LANGUAGES.filter((l) => settings.languages.enabled.includes(l.code)),
    signedIn: !!user,
  };
  res.json(view);
});

publicRouter.get('/stations/:token/sops/:sopId/render', async (req, res) => {
  const { s } = station(req);
  const sop = stationSop(s, param(req, 'sopId'));
  const lang = typeof req.query.lang === 'string' ? req.query.lang : 'en';
  const ctx = await buildContext(sop, {
    mode: 'web',
    purpose: 'view',
    language: lang,
    bilingual: req.query.bi === '1',
    translation: translationFor(sop, lang, 'exact'),
    mediaBase: `/api/public/stations/${s.token}/media`,
  });
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(renderHtml(ctx));
});

async function sendMedia(req: Request, res: import('express').Response, mediaId: string, variant: string) {
  if (variant === 'file') {
    const o = originalInfo(mediaId);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return sendOriginal(req, res, o.file, o.location, o.mime);
  }
  if (!['thumb', 'display', 'display-hq', 'poster'].includes(variant)) throw badRequest('Unknown variant');
  const v = await ensureVariant(mediaId, variant as Variant);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.type(v.contentType).sendFile(v.file);
}

publicRouter.get('/stations/:token/media/:mediaId/:variant', async (req, res) => {
  const { s } = station(req);
  if (!stationAllowsMedia(s, param(req, 'mediaId'))) throw new HttpError(404, 'Not found');
  await sendMedia(req, res, param(req, 'mediaId'), param(req, 'variant'));
});

const person = z.object({ name: z.string().trim().max(120).default(''), employeeId: z.string().trim().max(60).default('') });

publicRouter.post('/stations/:token/sops/:sopId/acknowledge', writeLimiter, (req, res) => {
  const { s, user } = station(req);
  if (!getSettings().training.enabled) throw badRequest('Sign-off is turned off');
  const sop = stationSop(s, param(req, 'sopId'));
  const body = parseBody(person, req);
  const result = acknowledge(
    sop.id,
    user ? { userId: user.id, name: user.name } : { name: body.name, employeeId: body.employeeId },
    { method: 'station', stationId: s.id },
  );
  res.json(result);
});

publicRouter.post('/stations/:token/sops/:sopId/runs', writeLimiter, (req, res) => {
  const { s, user } = station(req);
  const sop = stationSop(s, param(req, 'sopId'));
  const body = parseBody(person.extend({ language: z.string().max(8).default('en'), fields: z.record(z.string(), z.string()).default({}) }), req);
  const run = startRun({ sopId: sop.id, user, name: body.name, employeeId: body.employeeId, stationId: s.id, language: body.language, fields: body.fields });
  res.status(201).json(run);
});

// ---- Checklist runs (the token in the link is the access key) ----

publicRouter.get('/runs/:token', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(getRunByToken(param(req, 'token')));
});

const resultSchema = z.object({
  result: z.enum(['pass', 'fail', 'na', 'done']).nullable().optional(),
  note: z.string().max(1000).optional(),
  mediaIds: z.array(z.string()).max(10).optional(),
});

publicRouter.put('/runs/:token', writeLimiter, (req, res) => {
  const body = parseBody(z.object({ fields: z.record(z.string(), z.string()).optional(), results: z.record(z.string(), resultSchema).optional() }), req);
  res.json(updateRun(param(req, 'token'), body));
});

publicRouter.post('/runs/:token/complete', writeLimiter, (req, res) => {
  const body = parseBody(z.object({ signature: z.string().max(120).default('') }), req);
  res.json(completeRun(param(req, 'token'), body.signature));
});

publicRouter.post('/runs/:token/photos', writeLimiter, upload.single('photo'), async (req, res) => {
  const f = req.file;
  try {
    const run = getRunByToken(param(req, 'token'));
    if (run.status === 'completed') throw badRequest('This checklist is already completed');
    if (!f) throw badRequest('No photo received');
    if (!f.mimetype.startsWith('image/')) throw badRequest('Only photos can be added to a checklist');
    if (f.size > 25 * 1024 * 1024) throw badRequest('Photo is too large (25 MB max)');
    const user = userFromRequest(req);
    res.status(201).json(await storeFile(f.path, f.originalname || 'photo.jpg', f.mimetype, user?.id ?? null));
  } finally {
    if (f) await fsp.rm(f.path, { force: true });
  }
});

publicRouter.get('/runs/:token/media/:mediaId/:variant', async (req, res) => {
  if (!runAllowsMedia(param(req, 'token'), param(req, 'mediaId'))) throw new HttpError(404, 'Not found');
  getMedia(param(req, 'mediaId'));
  await sendMedia(req, res, param(req, 'mediaId'), param(req, 'variant'));
});
