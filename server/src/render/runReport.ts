import type { ChecklistRun } from '../../../shared/types';
import { getSettings } from '../services/settings';
import { escapeHtml as e } from '../util';
import { fontFaceCss } from './assets';
import { htmlToPdf } from './pdf';

const LABEL: Record<string, { text: string; color: string; bg: string }> = {
  pass: { text: 'PASS', color: '#166534', bg: '#dcfce7' },
  done: { text: 'DONE', color: '#166534', bg: '#dcfce7' },
  fail: { text: 'FAIL', color: '#b91c1c', bg: '#fee2e2' },
  na: { text: 'N/A', color: '#475569', bg: '#e2e8f0' },
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

/** Printable record of a completed checklist. */
export async function runReportPdf(run: ChecklistRun): Promise<Buffer> {
  const s = getSettings();
  const logo = s.branding.logoMediaId ? `<img class="logo" src="/api/public/logo" alt="">` : '';
  const fields = run.fieldValues.map((f) => `<div><span>${e(f.label)}</span><b>${e(f.value || '—')}</b></div>`).join('');
  const rows = run.steps
    .map((st) => {
      if (st.kind === 'section') return `<tr class="phase"><td colspan="3">${e(st.title)}</td></tr>`;
      const r = run.results[st.id];
      const l = r?.result ? LABEL[r.result] : null;
      const photos = (r?.mediaIds ?? []).map((id) => `<img src="/api/media/${id}/thumb" alt="">`).join('');
      return `<tr><td class="n">${st.number}</td><td><b>${e(st.title)}</b>${r?.note ? `<div class="note">${e(r.note)}</div>` : ''}${photos ? `<div class="photos">${photos}</div>` : ''}</td><td class="res">${
        l ? `<span style="color:${l.color};background:${l.bg}">${l.text}</span>` : '—'
      }</td></tr>`;
    })
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaceCss(['inter'])}
@page { size: Letter; margin: 0.6in 0.6in 0.7in; }
body { font-family: 'Inter', Arial, sans-serif; color: #1f2937; font-size: 10pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3pt solid ${s.branding.appColor}; padding-bottom: 8pt; margin-bottom: 12pt; }
.logo { max-height: 34pt; max-width: 2in; }
h1 { font-size: 17pt; margin: 0; }
.sub { color: #64748b; }
.status { font-weight: 700; padding: 3pt 8pt; border-radius: 4pt; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6pt 14pt; margin-bottom: 12pt; }
.grid span { display: block; font-size: 8pt; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; background: #f1f5f9; padding: 5pt; font-size: 8.5pt; }
td { padding: 6pt 5pt; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
tr { break-inside: avoid; }
td.n { width: 22pt; color: #64748b; font-weight: 700; }
td.res { width: 54pt; text-align: center; }
td.res span { display: inline-block; font-weight: 800; font-size: 8pt; padding: 2pt 6pt; border-radius: 3pt; }
tr.phase td { background: #f8fafc; font-weight: 700; color: ${s.branding.appColor}; }
.note { margin-top: 3pt; color: #b91c1c; }
.photos img { height: 70pt; margin: 4pt 4pt 0 0; border-radius: 3pt; border: 1px solid #e5e7eb; }
.sign { margin-top: 16pt; padding-top: 8pt; border-top: 1px solid #cbd5e1; display: flex; justify-content: space-between; }
</style></head><body>
<header><div><div class="sub">${e(run.sopNumber)} · Rev ${e(run.version)} · Checklist record</div><h1>${e(run.sopTitle)}</h1></div>${logo}</header>
<div class="grid">
  <div><span>Performed by</span><b>${e(run.performerName)}${run.employeeId ? ` (${e(run.employeeId)})` : ''}</b></div>
  <div><span>Started</span><b>${e(when(run.startedAt))}</b></div>
  <div><span>Completed</span><b>${e(when(run.completedAt))}</b></div>
  ${run.stationName ? `<div><span>Station</span><b>${e(run.stationName)}</b></div>` : ''}
  <div><span>Result</span><b class="status" style="color:${run.failCount ? '#b91c1c' : '#166534'}">${run.status === 'completed' ? (run.failCount ? `${run.failCount} item(s) failed` : 'All items passed') : 'In progress'}</b></div>
  ${fields}
</div>
<table><thead><tr><th>#</th><th>Item</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>
<div class="sign"><div>Signed: <b>${e(run.signature || '—')}</b></div><div>${e(s.branding.companyName)}</div></div>
</body></html>`;
  return htmlToPdf(html, { title: `${run.sopNumber} checklist`, author: s.branding.companyName, subject: 'Checklist record', keywords: [] }, { paged: false });
}
