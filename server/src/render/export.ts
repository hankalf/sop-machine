import { STATUS_LABELS, fillTokens } from '../../../shared/defaults';
import type { Sop } from '../../../shared/types';
import { getSettings } from '../services/settings';
import { safeFilename } from '../util';
import { buildContext } from './context';
import { renderDocx } from './docx';
import { renderHtml } from './html';
import { htmlToPdf } from './pdf';

export async function exportSop(sop: Sop, format: 'pdf' | 'docx'): Promise<{ data: Buffer; filename: string; contentType: string }> {
  const settings = getSettings();
  const ctx = await buildContext(sop, { mode: 'paged', purpose: 'pdf' });
  const base = safeFilename(
    fillTokens(settings.export.filenamePattern, {
      number: sop.number,
      title: sop.title,
      version: sop.version,
      status: STATUS_LABELS[sop.status] ?? sop.status,
      date: new Date().toISOString().slice(0, 10),
      company: settings.branding.companyName,
    }),
  );
  if (format === 'docx') {
    return {
      data: await renderDocx(ctx),
      filename: `${base}.docx`,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
  const data = await htmlToPdf(renderHtml(ctx), {
    title: `${sop.number} ${sop.title}`,
    author: settings.branding.companyName,
    subject: `Standard Operating Procedure, revision ${sop.version}`,
    keywords: sop.tags,
  });
  return { data, filename: `${base}.pdf`, contentType: 'application/pdf' };
}

export function contentDisposition(filename: string, inline = false) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
