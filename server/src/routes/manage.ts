import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth';
import { actionCounts, createAction, deleteAction, getAction, listActions, updateAction } from '../services/actions';
import { dashboard } from '../services/dashboard';
import { sopEvents } from '../services/events';
import { deleteSchedule, describeSchedule, listSchedules, saveSchedule, scheduleBoard } from '../services/schedules';
import { deletePerson, deleteTeam, importRoster, listRoster, listTeams, savePerson, saveTeam } from '../services/teams';
import { badRequest, param, parseBody } from '../util';

/** Corrective actions, schedules, teams, roster and the dashboard (editors and admins). */
export const manageRouter = Router();
const editor = requireRole('editor');

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date');

// ---- Corrective actions ----
manageRouter.get('/actions', editor, (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  res.json(listActions({ status: q.status, assigneeId: q.mine === '1' ? req.user!.id : q.assigneeId, overdue: q.overdue === '1', sopId: q.sopId, stationId: q.stationId }));
});
manageRouter.get('/actions/counts', editor, (req, res) => {
  res.json(actionCounts(req.user!.id));
});
manageRouter.get('/actions/:id', editor, (req, res) => {
  res.json(getAction(param(req, 'id')));
});
const actionFields = {
  title: z.string().trim().min(1).max(200),
  detail: z.string().max(4000),
  priority: z.enum(['normal', 'high']),
  sopId: z.string().nullable(),
  stationId: z.string().nullable(),
  assigneeId: z.string().nullable(),
  dueDate: date.nullable(),
};
const actionBody = z.object({
  ...actionFields,
  detail: actionFields.detail.default(''),
  priority: actionFields.priority.default('normal'),
  sopId: actionFields.sopId.default(null),
  stationId: actionFields.stationId.default(null),
  assigneeId: actionFields.assigneeId.default(null),
  dueDate: actionFields.dueDate.default(null),
});
// No defaults here: a field left out of an update must stay as it is.
const actionPatch = z
  .object(actionFields)
  .partial()
  .extend({ status: z.enum(['open', 'in_progress', 'done', 'cancelled']).optional(), resolution: z.string().max(4000).optional() });
manageRouter.post('/actions', editor, (req, res) => {
  const a = createAction(parseBody(actionBody, req), req.user!);
  if (a.assigneeId && a.assigneeId !== req.user!.id) sopEvents.emitSop('actionReassigned', a, req.user!);
  res.status(201).json(a);
});
manageRouter.put('/actions/:id', editor, (req, res) => {
  const { action, reassigned } = updateAction(param(req, 'id'), parseBody(actionPatch, req), req.user!);
  if (reassigned) sopEvents.emitSop('actionReassigned', action, req.user!);
  res.json(action);
});
manageRouter.delete('/actions/:id', requireRole('admin'), (req, res) => {
  deleteAction(param(req, 'id'));
  res.json({ ok: true });
});

// ---- Scheduled checklists ----
manageRouter.get('/schedules', editor, (_req, res) => {
  res.json(listSchedules().map((s) => ({ ...s, description: describeSchedule(s) })));
});
manageRouter.get('/schedules/board', editor, (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
  res.json(scheduleBoard(days));
});
const scheduleBody = z.object({
  sopId: z.string(),
  stationIds: z.array(z.string()).max(100).default([]),
  frequency: z.enum(['shift', 'daily', 'weekly', 'monthly']),
  days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  shiftIds: z.array(z.string()).default([]),
  active: z.boolean().default(true),
});
manageRouter.post('/schedules', requireRole('admin'), (req, res) => {
  res.status(201).json(saveSchedule(null, parseBody(scheduleBody, req), req.user!.id));
});
manageRouter.put('/schedules/:id', requireRole('admin'), (req, res) => {
  res.json(saveSchedule(param(req, 'id'), parseBody(scheduleBody, req), req.user!.id));
});
manageRouter.delete('/schedules/:id', requireRole('admin'), (req, res) => {
  deleteSchedule(param(req, 'id'));
  res.json({ ok: true });
});

// ---- Teams & roster ----
manageRouter.get('/teams', editor, (_req, res) => {
  res.json(listTeams());
});
const teamBody = z.object({ name: z.string().trim().min(1).max(80), categoryIds: z.array(z.string()).default([]), sopIds: z.array(z.string()).default([]) });
manageRouter.post('/teams', requireRole('admin'), (req, res) => {
  res.status(201).json(saveTeam(null, parseBody(teamBody, req)));
});
manageRouter.put('/teams/:id', requireRole('admin'), (req, res) => {
  res.json(saveTeam(param(req, 'id'), parseBody(teamBody, req)));
});
manageRouter.delete('/teams/:id', requireRole('admin'), (req, res) => {
  deleteTeam(param(req, 'id'));
  res.json({ ok: true });
});
manageRouter.get('/roster', editor, (_req, res) => {
  res.json(listRoster());
});
const personBody = z.object({ name: z.string().max(120), employeeId: z.string().max(60).default(''), teamId: z.string().nullable().default(null), active: z.boolean().default(true) });
manageRouter.post('/roster', editor, (req, res) => {
  res.status(201).json(savePerson(null, parseBody(personBody, req)));
});
manageRouter.post('/roster/import', editor, (req, res) => {
  const body = parseBody(z.object({ text: z.string().max(200_000), teamId: z.string().nullable().default(null) }), req);
  if (!body.text.trim()) throw badRequest('Paste at least one name');
  res.json(importRoster(body.text, body.teamId));
});
manageRouter.put('/roster/:id', editor, (req, res) => {
  res.json(savePerson(param(req, 'id'), parseBody(personBody, req)));
});
manageRouter.delete('/roster/:id', requireRole('admin'), (req, res) => {
  deletePerson(param(req, 'id'));
  res.json({ ok: true });
});

// ---- Dashboard ----
manageRouter.get('/dashboard', editor, (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  res.json(dashboard(days));
});
