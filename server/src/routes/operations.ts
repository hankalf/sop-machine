import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth';
import { db } from '../db';
import { binderTitle } from '../render/binder';
import { contentDisposition } from '../render/export';
import { stationPlacard, type PlacardSize } from '../render/placard';
import { runReportPdf } from '../render/runReport';
import { createJob } from '../services/generator';
import { deleteRun, getRunById, listRuns, runsCsv } from '../services/runs';
import { deleteStation, getStation, listStations, rotateToken, saveStation } from '../services/stations';
import { deleteAcknowledgment, matrixCsv, trainingMatrix } from '../services/training';
import { param, parseBody } from '../util';

/** Stations, training records, checklist records and binders. */
export const opsRouter = Router();

const size = (v: unknown): PlacardSize => (v === 'half' || v === 'card' ? v : 'letter');

/** Names for "owner" pickers (editors cannot see the full user admin list). */
opsRouter.get('/directory', requireRole('editor'), (_req, res) => {
  res.json(db.prepare("SELECT id, name FROM users WHERE disabled = 0 AND role != 'viewer' ORDER BY name").all());
});

// ---- Stations ----
const stationBody = z.object({
  name: z.string().trim().min(1).max(80),
  area: z.string().trim().max(80).default(''),
  sopIds: z.array(z.string()).max(100).default([]),
  publicAccess: z.boolean().default(false),
});

opsRouter.get('/stations', requireRole('editor'), (_req, res) => {
  res.json(listStations());
});
opsRouter.post('/stations', requireRole('editor'), (req, res) => {
  res.status(201).json(saveStation(null, parseBody(stationBody, req)));
});
opsRouter.put('/stations/:id', requireRole('editor'), (req, res) => {
  res.json(saveStation(param(req, 'id'), parseBody(stationBody, req)));
});
opsRouter.post('/stations/:id/rotate', requireRole('admin'), (req, res) => {
  res.json(rotateToken(param(req, 'id')));
});
opsRouter.delete('/stations/:id', requireRole('admin'), (req, res) => {
  deleteStation(param(req, 'id'));
  res.json({ ok: true });
});
opsRouter.get('/stations/:id/placard', requireRole('editor'), async (req, res) => {
  const st = getStation(param(req, 'id'));
  const pdf = await stationPlacard(st, size(req.query.size));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', contentDisposition(`QR placard - ${st.name}.pdf`));
  res.send(pdf);
});

// ---- Training ----
opsRouter.get('/training/matrix', requireRole('editor'), (req, res) => {
  res.json(trainingMatrix(typeof req.query.categoryId === 'string' && req.query.categoryId ? req.query.categoryId : undefined));
});
opsRouter.get('/training/matrix.csv', requireRole('editor'), (req, res) => {
  const m = trainingMatrix(typeof req.query.categoryId === 'string' && req.query.categoryId ? req.query.categoryId : undefined);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', contentDisposition(`training-matrix-${new Date().toISOString().slice(0, 10)}.csv`));
  res.send(`﻿${matrixCsv(m)}`);
});
opsRouter.delete('/acknowledgments/:id', requireRole('admin'), (req, res) => {
  deleteAcknowledgment(param(req, 'id'));
  res.json({ ok: true });
});

// ---- Checklist records ----
function runQuery(q: Record<string, unknown>) {
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  return { sopId: str(q.sopId), status: str(q.status), failed: q.failed === '1', from: str(q.from), to: str(q.to) };
}
opsRouter.get('/runs', requireRole('editor'), (req, res) => {
  res.json(listRuns(runQuery(req.query)));
});
opsRouter.get('/runs.csv', requireRole('editor'), (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', contentDisposition(`checklist-records-${new Date().toISOString().slice(0, 10)}.csv`));
  res.send(`﻿${runsCsv(listRuns({ ...runQuery(req.query), limit: 5000 }))}`);
});
opsRouter.get('/runs/:id', requireRole('editor'), (req, res) => {
  res.json(getRunById(param(req, 'id')));
});
opsRouter.get('/runs/:id/pdf', requireRole('editor'), async (req, res) => {
  const run = getRunById(param(req, 'id'));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', contentDisposition(`${run.sopNumber} checklist ${run.startedAt.slice(0, 10)} ${run.performerName}.pdf`));
  res.send(await runReportPdf(run));
});
opsRouter.delete('/runs/:id', requireRole('admin'), (req, res) => {
  deleteRun(param(req, 'id'));
  res.json({ ok: true });
});

// ---- Binders ----
opsRouter.post('/binders', (req, res) => {
  const body = parseBody(
    z.object({
      title: z.string().max(120).optional(),
      categoryId: z.string().nullable().default(null),
      sopIds: z.array(z.string()).max(500).nullable().default(null),
      includeDrafts: z.boolean().default(false),
      language: z.string().max(8).default('en'),
      bilingual: z.boolean().default(false),
    }),
    req,
  );
  const includeDrafts = body.includeDrafts && req.user!.role !== 'viewer';
  const title = binderTitle(body.categoryId, body.title);
  res.status(201).json(createJob('binder', title, { ...body, includeDrafts, title }, req.user!));
});
