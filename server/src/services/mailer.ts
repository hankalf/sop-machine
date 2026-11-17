import nodemailer, { type Transporter } from 'nodemailer';

const host = process.env.SMTP_HOST?.trim();
const port = Number(process.env.SMTP_PORT ?? 587);
const from = process.env.SMTP_FROM?.trim() || (process.env.SMTP_USER ? `SOP Machine <${process.env.SMTP_USER}>` : '');

export const emailConfigured = Boolean(host && from);
export const emailFrom = emailConfigured ? from : null;

let transporter: Transporter | null = null;
function transport(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
    });
  }
  return transporter;
}

export async function sendEmail(msg: { to: string[]; subject: string; html: string; text: string }) {
  if (!emailConfigured) throw new Error('Email is not configured (set SMTP_HOST and SMTP_FROM)');
  await transport().sendMail({ from, to: msg.to.join(', '), subject: msg.subject, html: msg.html, text: msg.text });
}
