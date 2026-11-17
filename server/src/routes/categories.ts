import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth';
import { deleteCategory, listCategories, saveCategory } from '../services/templates';
import { param, parseBody } from '../util';

export const categoriesRouter = Router();

const category = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().min(1).max(8).regex(/^[A-Za-z0-9]+$/, 'Use letters and numbers only').transform((s) => s.toUpperCase()),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  description: z.string().max(300).default(''),
  templateId: z.string().nullable(),
  sortOrder: z.number().int().default(0),
});

categoriesRouter.get('/', (_req, res) => {
  res.json(listCategories());
});

categoriesRouter.post('/', requireRole('admin'), (req, res) => {
  res.status(201).json(saveCategory(null, parseBody(category, req)));
});

categoriesRouter.put('/:id', requireRole('admin'), (req, res) => {
  res.json(saveCategory(param(req, 'id'), parseBody(category, req)));
});

categoriesRouter.delete('/:id', requireRole('admin'), (req, res) => {
  deleteCategory(param(req, 'id'));
  res.json({ ok: true });
});
