import fsp from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import mammoth from 'mammoth';
import { z } from 'zod';
import { requireRole } from '../auth';
import { config } from '../config';
import { isAiConfigured } from '../services/ai';
import type { JobType } from '../../../shared/types';
import { createJob, getJob, jobFile, listJobs } from '../services/generator';
import { contentDisposition } from '../render/export';
import { documentKind } from '../services/documents';
import { storeFile } from '../services/media';
import { badRequest, newId, param } from '../util';
import { upload } from './upload';

export const generateRouter = Router();
generateRouter.use(requireRole('editor'));

const ctxSchema = z.object({
  recordingType: z.enum(['screen', 'physical']).default('screen'),
  systemName: z.string().max(200).default(''),
  processName: z.string().max(300).default(''),
  audience: z.string().max(200).default(''),
  notes: z.string().max(5000).default(''),
  categoryId: z.string().optional(),
});

generateRouter.get('/status', (_req, res) => {
  res.json({ configured: isAiConfigured() });
});

function requireAi() {
  if (!isAiConfigured()) throw badRequest('AI generation is not set up. An administrator needs to add the ANTHROPIC_API_KEY variable in Railway.');
}

generateRouter.post('/recording', upload.single('video'), async (req, res) => {
  const f = req.file;
  try {
    requireAi();
    if (!f) throw badRequest('Upload a video file');
    const fields = ctxSchema.parse(req.body ?? {});
    const media = await storeFile(f.path, f.originalname, f.mimetype, req.user!.id);
    if (media.kind !== 'video') throw badRequest('That file is not a video');
    const { categoryId, ...ctx } = fields;
    const job = createJob('recording', fields.processName || f.originalname, { videoMediaId: media.id, categoryId: categoryId || null, ctx }, req.user!);
    res.status(201).json(job);
  } finally {
    if (f) await fsp.rm(f.path, { force: true });
  }
});

generateRouter.post('/notes', upload.single('document'), async (req, res) => {
  const f = req.file;
  try {
    requireAi();
    const fields = ctxSchema.extend({ text: z.string().max(200_000).default('') }).parse(req.body ?? {});
    let text = fields.text;
    let pdfPath: string | null = null;
    if (f) {
      const name = f.originalname.toLowerCase();
      if (name.endsWith('.pdf') || f.mimetype === 'application/pdf') {
        if (f.size > 30 * 1024 * 1024) throw badRequest('PDFs must be under 30 MB');
        pdfPath = path.join(config.tmpDir, `${newId()}.pdf`);
        await fsp.copyFile(f.path, pdfPath);
      } else if (name.endsWith('.docx')) {
        text = `${(await mammoth.extractRawText({ path: f.path })).value}\n\n${text}`;
      } else if (name.endsWith('.txt') || name.endsWith('.md') || f.mimetype.startsWith('text/')) {
        text = `${await fsp.readFile(f.path, 'utf8')}\n\n${text}`;
      } else {
        throw badRequest('Upload a PDF, Word (.docx) or text file');
      }
    }
    if (!text.trim() && !pdfPath) throw badRequest('Paste some notes or upload a document');
    const { categoryId, ...ctx } = fields;
    const job = createJob('notes', fields.processName || f?.originalname || 'Notes', { text, pdfPath, categoryId: categoryId || null, ctx }, req.user!);
    res.status(201).json(job);
  } finally {
    if (f) await fsp.rm(f.path, { force: true });
  }
});

/** Bulk import of existing SOP documents: one conversion job per file. */
generateRouter.post('/import', upload.array('documents', 25), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  try {
    requireAi();
    if (!files.length) throw badRequest('Choose at least one SOP document to import');
    const fields = z
      .object({ categoryId: z.string().default('auto'), templateId: z.string().default(''), keepNumbers: z.enum(['true', 'false']).default('true') })
      .parse(req.body ?? {});
    for (const f of files) {
      if (!documentKind(f.originalname, f.mimetype)) throw badRequest(`${f.originalname}: use PDF, Word (.docx) or text files. Save old .doc files as .docx first.`);
      if (f.size > 30 * 1024 * 1024) throw badRequest(`${f.originalname} is over 30 MB`);
    }
    const jobs = [];
    for (const f of files) {
      const kept = path.join(config.tmpDir, `${newId()}${path.extname(f.originalname).toLowerCase()}`);
      await fsp.copyFile(f.path, kept);
      jobs.push(
        createJob(
          'import',
          f.originalname,
          {
            filePath: kept,
            fileName: f.originalname,
            mime: f.mimetype,
            categoryId: fields.categoryId || null,
            templateId: fields.templateId || null,
            keepNumbers: fields.keepNumbers === 'true',
          },
          req.user!,
        ),
      );
    }
    res.status(201).json(jobs);
  } finally {
    await Promise.all(files.map((f) => fsp.rm(f.path, { force: true })));
  }
});

export const jobsRouter = Router();
jobsRouter.use(requireRole('editor'));
const ALL_TYPES: JobType[] = ['recording', 'notes', 'import', 'translate', 'binder', 'storage'];
jobsRouter.get('/', (req, res) => {
  const wanted = String(req.query.types ?? 'recording,notes,import,translate')
    .split(',')
    .filter((t): t is JobType => (ALL_TYPES as string[]).includes(t));
  res.json(listJobs(wanted.length ? wanted : ALL_TYPES));
});
jobsRouter.get('/:id/download', (req, res) => {
  const f = jobFile(param(req, 'id'));
  if (!f) throw badRequest('This file has expired. Build it again.');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', contentDisposition(`${f.title}.pdf`));
  res.sendFile(f.file);
});
jobsRouter.get('/:id', (req, res) => {
  res.json(getJob(param(req, 'id')));
});
