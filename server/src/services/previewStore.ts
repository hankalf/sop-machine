import crypto from 'node:crypto';

/**
 * Short-lived store for Template Designer previews. The preview iframe loads them from a real
 * same-origin URL (Paged.js resolves font and stylesheet URLs against the page address,
 * which fails in srcdoc/blob iframes).
 */
const store = new Map<string, { html: string; userId: string; expires: number }>();
const TTL = 10 * 60 * 1000;
const MAX = 300;

export function putPreview(html: string, userId: string): string {
  const now = Date.now();
  for (const [k, v] of store) if (v.expires < now) store.delete(k);
  while (store.size >= MAX) store.delete(store.keys().next().value!);
  const token = crypto.randomBytes(12).toString('hex');
  store.set(token, { html, userId, expires: now + TTL });
  return token;
}

export function getPreview(token: string, userId: string): string | null {
  const entry = store.get(token);
  if (!entry || entry.userId !== userId || entry.expires < Date.now()) return null;
  return entry.html;
}
