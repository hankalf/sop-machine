import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import type { Role, User } from '../../shared/types';
import { config } from './config';
import { db, getMeta, setMeta } from './db';
import { HttpError, newId, nowIso } from './util';

export const SESSION_COOKIE = 'sop_session';
const SESSION_DAYS = 30;

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  password_hash: string;
  disabled: number;
  created_at: string;
  last_login_at: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
  }
}

function sessionSecret(): string {
  if (config.sessionSecret) return config.sessionSecret;
  let secret = getMeta('session_secret');
  if (!secret) {
    secret = crypto.randomBytes(48).toString('hex');
    setMeta('session_secret', secret);
  }
  return secret;
}

const secret = sessionSecret();

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    disabled: !!row.disabled,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

/** Changing a password changes the fingerprint, which signs out existing sessions. */
const fingerprint = (hash: string) => crypto.createHash('sha256').update(hash).digest('hex').slice(0, 12);

export function hashPassword(password: string) {
  return bcrypt.hashSync(password, 11);
}

let dummy: string | null = null;
const dummyHash = () => (dummy ??= bcrypt.hashSync('not-a-real-password', 11));

export function findUserByEmail(email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim()) as UserRow | undefined;
}

export function getUserRow(id: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function verifyLogin(email: string, password: string): User | null {
  const row = findUserByEmail(email);
  if (!row || row.disabled) {
    // Spend comparable time so response timing does not reveal valid emails.
    bcrypt.compareSync(password, dummyHash());
    return null;
  }
  if (!bcrypt.compareSync(password, row.password_hash)) return null;
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), row.id);
  return toUser(row);
}

export function issueSession(res: Response, userId: string) {
  const row = getUserRow(userId);
  if (!row) throw new HttpError(401, 'Unknown user');
  const token = jwt.sign({ sub: row.id, fp: fingerprint(row.password_hash) }, secret, {
    expiresIn: `${SESSION_DAYS}d`,
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd && config.appUrl.startsWith('https://'),
    maxAge: SESSION_DAYS * 24 * 3600 * 1000,
    path: '/',
  });
}

export function clearSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function userFromRequest(req: Request): User | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, secret) as { sub: string; fp: string };
    const row = getUserRow(payload.sub);
    if (!row || row.disabled || fingerprint(row.password_hash) !== payload.fp) return null;
    return toUser(row);
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const user = userFromRequest(req);
  if (!user) return next(new HttpError(401, 'Please sign in'));
  req.user = user;
  next();
}

const rank: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

export function hasRole(user: User | undefined, role: Role) {
  return !!user && rank[user.role] >= rank[role];
}

export function requireRole(role: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!hasRole(req.user, role)) return next(new HttpError(403, 'You do not have permission to do that'));
    next();
  };
}

/** Create the first admin account on an empty database. */
export function ensureAdmin() {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  if (count > 0) return;
  let password = config.adminPassword;
  const generated = !password;
  if (generated) password = crypto.randomBytes(9).toString('base64url');
  db.prepare(
    'INSERT INTO users (id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(newId(), config.adminEmail, 'Administrator', 'admin', hashPassword(password), nowIso());
  const line = '='.repeat(64);
  console.log(`\n${line}\n  Created admin account: ${config.adminEmail}`);
  if (generated) console.log(`  Generated password:    ${password}\n  (set ADMIN_PASSWORD to choose your own)`);
  console.log(`${line}\n`);
}
