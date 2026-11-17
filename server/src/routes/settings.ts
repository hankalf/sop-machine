import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import { Router } from 'express';
import sharp from 'sharp';
import type { SystemInfo } from '../../../shared/types';
import { requireRole } from '../auth';
import { config } from '../config';
import { db } from '../db';
import { pdfEngineStatus } from '../render/pdf';
import { isAiConfigured } from '../services/ai';
import { storeBuffer, storeFile } from '../services/media';
import { getSettings, updateSettings } from '../services/settings';
import { badRequest } from '../util';
import { upload } from './upload';

export const settingsRouter = Router();

settingsRouter.get('/', (_req, res) => {
  res.json(getSettings());
});

settingsRouter.put('/', requireRole('admin'), (req, res) => {
  const patch = { ...(req.body ?? {}) };
  // The logo is managed through its own endpoint.
  if (patch.branding) patch.branding = { ...patch.branding, logoMediaId: getSettings().branding.logoMediaId };
  res.json(updateSettings(patch));
});

settingsRouter.post('/logo', requireRole('admin'), upload.single('file'), async (req, res) => {
  const f = req.file;
  if (!f) throw badRequest('No file received');
  try {
    let media;
    if (f.mimetype === 'image/svg+xml' || f.originalname.toLowerCase().endsWith('.svg')) {
      // Rasterize SVG logos so they render identically in PDF and Word (and can't carry scripts).
      const png = await sharp(await fsp.readFile(f.path), { density: 300 }).resize({ width: 1200, height: 600, fit: 'inside' }).png().toBuffer();
      media = await storeBuffer(png, f.originalname.replace(/\.svg$/i, '.png'), 'image/png', req.user!.id);
    } else {
      media = await storeFile(f.path, f.originalname, f.mimetype, req.user!.id);
      if (media.kind !== 'image') throw badRequest('The logo must be an image');
    }
    res.json(updateSettings({ branding: { logoMediaId: media.id } }));
  } finally {
    await fsp.rm(f.path, { force: true });
  }
});

settingsRouter.delete('/logo', requireRole('admin'), (_req, res) => {
  res.json(updateSettings({ branding: { logoMediaId: null } }));
});

export const systemRouter = Router();
systemRouter.use(requireRole('admin'));

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? await dirSize(p) : (await fsp.stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

systemRouter.get('/', async (_req, res) => {
  const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  let freeBytes: number | null = null;
  let totalBytes: number | null = null;
  try {
    const s = await fsp.statfs(config.dataDir);
    freeBytes = s.bavail * s.bsize;
    totalBytes = s.blocks * s.bsize;
  } catch {
    /* not supported */
  }
  const info: SystemInfo = {
    aiConfigured: isAiConfigured(),
    aiModel: getSettings().ai.model,
    appUrl: config.appUrl,
    dataDir: config.dataDir,
    disk: {
      uploadsBytes: (await dirSize(config.uploadsDir)) + (await dirSize(config.derivedDir)),
      databaseBytes: fs.existsSync(config.dbPath) ? fs.statSync(config.dbPath).size : 0,
      freeBytes,
      totalBytes,
    },
    counts: { sops: count('sops'), media: count('media'), users: count('users'), templates: count('templates') },
    versions: { app: process.env.npm_package_version ?? '1.0.0', node: process.version },
    pdfEngine: await pdfEngineStatus(),
  };
  res.json(info);
});

/** Download everything (database + uploaded files) as a zip. */
systemRouter.get('/backup', async (_req, res) => {
  const snapshot = path.join(config.tmpDir, `backup-${Date.now()}.db`);
  await db.backup(snapshot);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="sop-machine-backup-${stamp}.zip"`);
  const zip = archiver('zip', { zlib: { level: 1 } });
  zip.on('error', (err) => res.destroy(err));
  res.on('close', () => void fsp.rm(snapshot, { force: true }));
  zip.pipe(res);
  zip.file(snapshot, { name: 'sop-machine.db' });
  zip.directory(config.uploadsDir, 'uploads');
  await zip.finalize();
});
