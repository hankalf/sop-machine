import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { clearSession, getUserRow, hashPassword, issueSession, requireAuth, toUser, verifyLogin } from '../auth';
import { db } from '../db';
import { HttpError, badRequest, parseBody } from '../util';

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

authRouter.post('/login', loginLimiter, (req, res) => {
  const body = parseBody(z.object({ email: z.string().min(1), password: z.string().min(1) }), req);
  const user = verifyLogin(body.email, body.password);
  if (!user) throw new HttpError(401, 'Incorrect email or password');
  issueSession(res, user.id);
  res.json(user);
});

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

authRouter.put('/me', requireAuth, (req, res) => {
  const body = parseBody(
    z.object({ name: z.string().trim().min(1).max(120).optional(), currentPassword: z.string().optional(), newPassword: z.string().min(8).max(200).optional() }),
    req,
  );
  const row = getUserRow(req.user!.id)!;
  if (body.name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(body.name, row.id);
  if (body.newPassword) {
    if (!body.currentPassword || !bcrypt.compareSync(body.currentPassword, row.password_hash)) throw badRequest('Current password is incorrect');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.newPassword), row.id);
    issueSession(res, row.id);
  }
  res.json(toUser(getUserRow(row.id)!));
});
