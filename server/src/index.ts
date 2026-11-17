import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import multer from 'multer';
import { ZodError } from 'zod';
import { ensureAdmin, requireAuth } from './auth';
import { config } from './config';
import { db } from './db';
import { resolveAsset } from './render/assets';
import { closeBrowser } from './render/pdf';
import { authRouter } from './routes/auth';
import { categoriesRouter } from './routes/categories';
import { generateRouter, jobsRouter } from './routes/generate';
import { mediaRouter } from './routes/media';
import { settingsRouter, systemRouter } from './routes/settings';
import { sopsRouter } from './routes/sops';
import { templatesRouter } from './routes/templates';
import { usersRouter } from './routes/users';
import { opsRouter } from './routes/operations';
import { publicRouter } from './routes/public';
import { pruneExports } from './render/binder';
import { sopEvents } from './services/events';
import { startNotificationScheduler } from './services/notifications';
import { contentHash } from './services/translations';
import { createJob as createGenerationJob } from './services/generator';
import { getSettings } from './services/settings';
import { failInterruptedJobs } from './services/generator';
import { resumeProcessing } from './services/media';
import { publicBranding } from './services/settings';
import { seedTemplatesAndCategories } from './services/templates';
import { HttpError } from './util';

ensureAdmin();
seedTemplatesAndCategories();
failInterruptedJobs();
resumeProcessing();
startNotificationScheduler();
void pruneExports();
setInterval(() => void pruneExports(), 6 * 3600 * 1000);

// Keep translations in step with approved SOPs when the admin wants that.
sopEvents.onSop('approved', (sop, by) => {
  const s = getSettings();
  if (!s.languages.autoTranslate) return;
  const hash = contentHash(sop);
  for (const code of s.languages.enabled) {
    const exists = db.prepare('SELECT 1 FROM translations WHERE sop_id = ? AND language = ? AND source_hash = ?').get(sop.id, code, hash);
    if (!exists) createGenerationJob('translate', `${code.toUpperCase()}: ${sop.number} ${sop.title}`, { sopId: sop.id, language: code }, by);
  }
});

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// ---- Public endpoints ----
app.get('/api/health', (_req, res) => {
  db.prepare('SELECT 1').get();
  res.json({ ok: true });
});
app.get('/api/public/branding', (_req, res) => {
  res.json(publicBranding());
});
app.get('/api/public/logo', async (_req, res) => {
  const asset = await resolveAsset('/api/public/logo');
  if (!asset) return void res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.type(asset.contentType).sendFile(asset.file);
});

// Fonts and Paged.js used by rendered SOPs (public, static).
app.get('/render-assets/{*path}', async (req, res) => {
  const asset = await resolveAsset(req.path);
  if (!asset) return void res.status(404).end();
  res.setHeader('Cache-Control', config.isProd ? 'public, max-age=86400' : 'no-cache');
  res.type(asset.contentType).sendFile(asset.file);
});

app.use('/api/auth', authRouter);
app.use('/api/public', publicRouter);

// ---- Authenticated API ----
app.use('/api', requireAuth);
app.use('/api/sops', sopsRouter);
app.use('/api/media', mediaRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/system', systemRouter);
app.use('/api/users', usersRouter);
app.use('/api/generate', generateRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api', opsRouter);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

// ---- Web client (built by Vite) ----
const clientDir = path.join(config.appRoot, 'dist/client');
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir, { index: false, maxAge: '1h', setHeaders: (res, file) => {
    if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } }));
  app.get('/{*path}', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message, ...((err as { loginRequired?: boolean }).loginRequired ? { loginRequired: true } : {}) });
  if (err instanceof ZodError) return void res.status(400).json({ error: err.issues[0]?.message ?? 'Invalid input' });
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `File is too large (limit ${config.maxUploadMb} MB)` : err.message;
    return void res.status(400).json({ error: msg });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});

const server = app.listen(config.port, () => {
  console.log(`SOP Machine listening on http://localhost:${config.port}`);
  console.log(`Data directory: ${config.dataDir}`);
  console.log(`Public URL: ${config.appUrl}`);
  if (!config.chromiumPath) console.warn('Chromium not found: PDF export will not work. Set CHROMIUM_PATH.');
  if (!config.anthropicConfigured) console.warn('ANTHROPIC_API_KEY not set: AI generation is disabled.');
});
server.requestTimeout = 30 * 60 * 1000; // large video uploads
server.headersTimeout = 65 * 1000;

async function shutdown() {
  server.close();
  await closeBrowser();
  db.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
