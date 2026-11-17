import { customAlphabet } from 'nanoid';
import type { Request } from 'express';
import type { ZodType } from 'zod';

export const newId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what);
export const forbidden = (what = 'You do not have permission to do that') => new HttpError(403, what);
export const badRequest = (what: string) => new HttpError(400, what);

export function parseBody<T>(schema: ZodType<T>, req: Request): T {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw badRequest(`${issue.path.join('.') || 'body'}: ${issue.message}`);
  }
  return result.data;
}

export const nowIso = () => new Date().toISOString();

export function param(req: Request, name: string): string {
  const v = req.params[name];
  if (typeof v !== 'string' || !v) throw badRequest(`Missing ${name}`);
  return v;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 180) || 'document';
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return '';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
