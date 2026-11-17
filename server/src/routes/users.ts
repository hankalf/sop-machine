import { Router } from 'express';
import { z } from 'zod';
import { hashPassword, requireRole, toUser } from '../auth';
import { db } from '../db';
import { badRequest, newId, notFound, nowIso, param, parseBody } from '../util';

export const usersRouter = Router();
usersRouter.use(requireRole('admin'));

const role = z.enum(['admin', 'editor', 'viewer']);

usersRouter.get('/', (_req, res) => {
  res.json((db.prepare('SELECT * FROM users ORDER BY name').all() as Parameters<typeof toUser>[0][]).map(toUser));
});

usersRouter.post('/', (req, res) => {
  const body = parseBody(
    z.object({ email: z.email(), name: z.string().trim().min(1), role, password: z.string().min(8), language: z.string().min(2).max(8).default('en') }),
    req,
  );
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(body.email)) throw badRequest('A user with that email already exists');
  const id = newId();
  db.prepare('INSERT INTO users (id, email, name, role, language, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, body.email.trim(), body.name, body.role, body.language, hashPassword(body.password), nowIso(),
  );
  res.status(201).json(toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Parameters<typeof toUser>[0]));
});

function adminCount(excludeId: string) {
  return (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id != ?").get(excludeId) as { n: number }).n;
}

usersRouter.put('/:id', (req, res) => {
  const id = param(req, 'id');
  const body = parseBody(
    z.object({
      name: z.string().trim().min(1).optional(),
      role: role.optional(),
      disabled: z.boolean().optional(),
      password: z.string().min(8).optional(),
      language: z.string().min(2).max(8).optional(),
    }),
    req,
  );
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Parameters<typeof toUser>[0] & { password_hash: string } | undefined;
  if (!row) throw notFound('User not found');
  const demoting = (body.role && body.role !== 'admin') || body.disabled === true;
  if (row.role === 'admin' && demoting && adminCount(id) === 0) throw badRequest('There must be at least one active administrator');
  if (id === req.user!.id && body.disabled) throw badRequest('You cannot disable your own account');
  if (body.language) db.prepare('UPDATE users SET language = ? WHERE id = ?').run(body.language, id);
  db.prepare('UPDATE users SET name = ?, role = ?, disabled = ?, password_hash = ? WHERE id = ?').run(
    body.name ?? row.name,
    body.role ?? row.role,
    body.disabled === undefined ? (row.disabled ? 1 : 0) : body.disabled ? 1 : 0,
    body.password ? hashPassword(body.password) : row.password_hash,
    id,
  );
  res.json(toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Parameters<typeof toUser>[0]));
});

usersRouter.delete('/:id', (req, res) => {
  const id = param(req, 'id');
  if (id === req.user!.id) throw badRequest('You cannot delete your own account');
  const row = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: string } | undefined;
  if (row?.role === 'admin' && adminCount(id) === 0) throw badRequest('There must be at least one active administrator');
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});
