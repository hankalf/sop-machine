import type { Sop } from '../../../shared/types';
import { config } from '../config';
import { db } from '../db';
import { escapeHtml as e, formatDate, newId, nowIso } from '../util';
import { emailConfigured, sendEmail } from './mailer';
import { sopEvents } from './events';
import { getSettings } from './settings';
import { getSop } from './sops';

interface Recipient {
  email: string;
  name: string;
}

export function userById(id: string | null): Recipient | null {
  if (!id) return null;
  const r = db.prepare('SELECT email, name FROM users WHERE id = ? AND disabled = 0').get(id) as Recipient | undefined;
  return r ?? null;
}

export function admins(): Recipient[] {
  return db.prepare("SELECT email, name FROM users WHERE role = 'admin' AND disabled = 0").all() as Recipient[];
}

export function extras(): string[] {
  return getSettings()
    .notifications.extraRecipients.split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter((x) => /.+@.+\..+/.test(x));
}

const sopLink = (sop: Sop) => `${config.appUrl}/sops/${sop.id}`;

export function emailHtml(opts: { heading: string; intro: string; rows?: [string, string][]; button?: { label: string; url: string }; footer?: string }) {
  const s = getSettings();
  const color = s.branding.appColor;
  const logo = s.branding.logoMediaId ? `<img src="${config.appUrl}/api/public/logo" alt="${e(s.branding.companyName)}" style="max-height:40px;max-width:180px">` : `<strong style="font-size:16px">${e(s.branding.companyName)}</strong>`;
  const rows = (opts.rows ?? [])
    .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap">${e(k)}</td><td style="padding:6px 0;color:#0f172a;font-weight:600">${e(v)}</td></tr>`)
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="padding:18px 24px;border-bottom:4px solid ${color}">${logo}</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 8px;font-size:20px;color:#0f172a">${e(opts.heading)}</h1>
<p style="margin:0 0 16px;color:#334155;font-size:14px;line-height:1.5">${e(opts.intro)}</p>
${rows ? `<table role="presentation" style="font-size:14px;margin-bottom:18px">${rows}</table>` : ''}
${opts.button ? `<a href="${e(opts.button.url)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">${e(opts.button.label)}</a>` : ''}
</td></tr>
<tr><td style="padding:14px 24px;background:#f8fafc;color:#94a3b8;font-size:12px">${e(opts.footer ?? `${s.branding.siteName} · ${s.branding.companyName}`)}</td></tr>
</table></body></html>`;
}

/** Send once per dedupe key. Skips quietly (without recording) while email isn't set up. */
export async function deliver(kind: string, dedupeKey: string, sop: Sop | null, to: string[], subject: string, html: string, text: string) {
  const recipients = [...new Set(to.map((x) => x.toLowerCase()))];
  if (!recipients.length || !emailConfigured || !getSettings().notifications.enabled) return;
  const id = newId();
  const inserted = db
    .prepare('INSERT OR IGNORE INTO notifications (id, kind, dedupe_key, sop_id, recipients, subject, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, kind, dedupeKey, sop?.id ?? null, recipients.join(', '), subject, 'sending', nowIso());
  if (inserted.changes === 0) return;
  try {
    await sendEmail({ to: recipients, subject, html, text });
    db.prepare("UPDATE notifications SET status = 'sent' WHERE id = ?").run(id);
  } catch (err) {
    db.prepare("UPDATE notifications SET status = 'failed', error = ? WHERE id = ?").run((err as Error).message.slice(0, 500), id);
    console.error('[email] failed', subject, err);
  }
}

const sopRows = (sop: Sop): [string, string][] => [
  ['SOP', `${sop.number} · ${sop.title}`],
  ['Revision', sop.version],
  ['Owner', sop.owner || '—'],
];

export async function sendTestEmail(to: string) {
  if (!emailConfigured) throw new Error('Email is not configured. Set SMTP_HOST, SMTP_FROM (and SMTP_USER/SMTP_PASS) in Railway.');
  await sendEmail({
    to: [to],
    subject: 'SOP Machine test email',
    html: emailHtml({ heading: 'Email is working', intro: 'Review reminders and approval notifications will be delivered like this one.', button: { label: 'Open SOP Machine', url: config.appUrl } }),
    text: `Email is working. ${config.appUrl}`,
  });
  db.prepare("INSERT INTO notifications (id, kind, dedupe_key, sop_id, recipients, subject, status, created_at) VALUES (?, 'test', ?, NULL, ?, 'SOP Machine test email', 'sent', ?)").run(
    newId(),
    `test:${newId()}`,
    to,
    nowIso(),
  );
}

export function listNotifications(limit = 50) {
  return db
    .prepare("SELECT id, kind, recipients, subject, status, error, created_at AS createdAt FROM notifications WHERE kind != 'marker' ORDER BY created_at DESC LIMIT ?")
    .all(limit);
}

/** Review reminders: once when the review date is close, once when it has passed. */
export async function runReviewReminders() {
  const s = getSettings();
  if (!s.notifications.enabled || !emailConfigured) return;
  const rows = db.prepare("SELECT id FROM sops WHERE status = 'approved' AND review_date IS NOT NULL").all() as { id: string }[];
  const today = new Date(new Date().toISOString().slice(0, 10));
  for (const { id } of rows) {
    const sop = getSop(id);
    const due = new Date(sop.reviewDate!);
    const days = Math.round((due.getTime() - today.getTime()) / 86400000);
    let kind: 'review-due' | 'review-overdue' | null = null;
    if (days < 0) kind = 'review-overdue';
    else if (days <= s.notifications.reviewReminderDays) kind = 'review-due';
    if (!kind) continue;
    const owner = userById(sop.ownerUserId);
    const to = [...(owner ? [owner.email] : admins().map((a) => a.email)), ...extras()];
    const subject = kind === 'review-overdue' ? `Review overdue: ${sop.number} ${sop.title}` : `Review due ${formatDate(sop.reviewDate)}: ${sop.number} ${sop.title}`;
    const intro =
      kind === 'review-overdue'
        ? `This SOP was due for its periodic review on ${formatDate(sop.reviewDate)}. Please confirm it still matches how the work is done, update it if needed, and approve it again.`
        : `This SOP is due for its periodic review in ${days} day${days === 1 ? '' : 's'}. Please confirm it still matches how the work is done.`;
    await deliver(kind, `${kind}:${sop.id}:${sop.reviewDate}`, sop, to, subject, emailHtml({ heading: subject, intro, rows: [...sopRows(sop), ['Review date', formatDate(sop.reviewDate)]], button: { label: 'Open SOP', url: sopLink(sop) } }), `${intro}\n${sopLink(sop)}`);
  }
}

export function startNotificationScheduler() {
  const tick = () => void runReviewReminders().catch((err) => console.error('[email] reminders failed', err));
  setTimeout(tick, 30_000);
  setInterval(tick, 60 * 60 * 1000);

  sopEvents.onSop('submitted', async (sop, by) => {
    if (!getSettings().notifications.onSubmitted) return;
    const to = [...admins().map((a) => a.email), ...extras()];
    const subject = `Review needed: ${sop.number} ${sop.title} (Rev ${sop.version})`;
    const intro = `${by.name} submitted this SOP for review. Please check it and approve it or send it back to draft.`;
    await deliver('submitted', `submitted:${sop.id}:${sop.version}:${Date.now()}`, sop, to, subject, emailHtml({ heading: 'An SOP is waiting for your review', intro, rows: sopRows(sop), button: { label: 'Review SOP', url: sopLink(sop) } }), `${intro}\n${sopLink(sop)}`);
  });

  sopEvents.onSop('approved', async (sop, by, previousVersion) => {
    const s = getSettings();
    if (s.notifications.onApproved) {
      const owner = userById(sop.ownerUserId);
      if (owner && owner.email.toLowerCase() !== by.email.toLowerCase()) {
        const subject = `Approved: ${sop.number} ${sop.title} (Rev ${sop.version})`;
        const intro = `${by.name} approved and published revision ${sop.version}.`;
        await deliver('approved', `approved:${sop.id}:${sop.version}`, sop, [owner.email, ...extras()], subject, emailHtml({ heading: 'Your SOP was approved', intro, rows: sopRows(sop), button: { label: 'Open SOP', url: sopLink(sop) } }), `${intro}\n${sopLink(sop)}`);
      }
    }
    // People who signed an earlier version need to read the new one.
    if (s.notifications.onNewRevision && s.training.enabled && previousVersion) {
      const people = db
        .prepare(
          `SELECT DISTINCT u.id, u.email, u.name FROM acknowledgments a JOIN users u ON u.id = a.user_id
           WHERE a.sop_id = ? AND a.version != ? AND u.disabled = 0`,
        )
        .all(sop.id, sop.version) as { id: string; email: string; name: string }[];
      for (const p of people) {
        const subject = `Updated SOP: please read and sign off ${sop.number} (Rev ${sop.version})`;
        const intro = `${sop.title} was updated from revision ${previousVersion} to ${sop.version}. Please read the new version and sign off that you understand the changes.`;
        await deliver('new-revision', `newrev:${sop.id}:${sop.version}:${p.id}`, sop, [p.email], subject, emailHtml({ heading: 'An SOP you signed was updated', intro, rows: sopRows(sop), button: { label: 'Read and sign off', url: sopLink(sop) } }), `${intro}\n${sopLink(sop)}`);
      }
    }
  });
}
