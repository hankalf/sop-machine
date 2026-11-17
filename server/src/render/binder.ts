import fsp from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { languageInfo } from '../../../shared/defaults';
import type { Sop } from '../../../shared/types';
import { config } from '../config';
import { db } from '../db';
import { getSettings } from '../services/settings';
import { getPublishedSop, getSop } from '../services/sops';
import { defaultTemplate, getCategory } from '../services/templates';
import { translationFor } from '../services/translations';
import { escapeHtml as e, formatDate } from '../util';
import { fontFaceCss } from './assets';
import { buildContext, qrDataUri } from './context';
import { pageGeometry, renderHtml } from './html';
import { htmlToPdf } from './pdf';

export interface BinderInput {
  title: string;
  categoryId: string | null;
  sopIds: string[] | null;
  /** Include working drafts; otherwise only the last approved version of each SOP. */
  includeDrafts: boolean;
  language: string;
  bilingual: boolean;
}

interface Entry {
  sop: Sop;
  pdf: Buffer;
  pages: number;
  englishOnly: boolean;
  title: string;
}

function selectSops(input: BinderInput): Sop[] {
  const ids = input.sopIds?.length
    ? input.sopIds
    : (db
        .prepare(`SELECT id FROM sops WHERE status != 'archived' ${input.categoryId ? 'AND category_id = ?' : ''}`)
        .all(...(input.categoryId ? [input.categoryId] : [])) as { id: string }[]).map((r) => r.id);
  const sops = ids.map((id) => (input.includeDrafts ? getSop(id) : getPublishedSop(id))).filter((s): s is Sop => !!s);
  return sops.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
}

function frontMatterHtml(input: BinderInput, entries: Entry[], startPages: number[], qr: string) {
  const s = getSettings();
  const geo = pageGeometry(defaultTemplate().design);
  const lang = input.language !== 'en' ? languageInfo(input.language) : null;
  const logo = s.branding.logoMediaId ? `<img class="logo" src="/api/public/logo" alt="">` : '';
  const rows = entries
    .map(
      (en, i) => `<tr><td class="num">${e(en.sop.number)}</td><td>${e(en.title)}${en.englishOnly && lang ? ` <span class="note">(English only)</span>` : ''}</td><td>${e(en.sop.version)}</td><td>${e(formatDate(en.sop.effectiveDate) || '—')}</td><td class="pg">${startPages[i]}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaceCss(['inter'])}
@page { size: ${geo.width}in ${geo.height}in; margin: 0.8in 0.75in; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Inter', Arial, sans-serif; color: #1f2937; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.cover { height: calc(${geo.height}in - 1.6in - 2px); display: flex; flex-direction: column; break-after: page; }
.logo { max-height: 0.9in; max-width: 3in; object-fit: contain; }
.company { font-weight: 600; font-size: 14pt; margin-top: 10pt; }
.kicker { margin-top: 1.6in; color: ${s.branding.appColor}; text-transform: uppercase; letter-spacing: .16em; font-weight: 700; font-size: 11pt; }
h1 { font-size: 34pt; margin: 8pt 0 10pt; line-height: 1.1; }
.bar { width: 1.6in; height: 5pt; background: ${s.branding.appColor}; margin-bottom: 16pt; }
.meta { font-size: 11pt; color: #475569; line-height: 1.7; }
.bottom { margin-top: auto; display: flex; gap: 14pt; align-items: center; font-size: 9pt; color: #475569; }
.bottom img { width: 1in; height: 1in; }
h2 { font-size: 18pt; color: ${s.branding.appColor}; margin: 0 0 12pt; padding-bottom: 6pt; border-bottom: 2pt solid ${s.branding.appColor}; }
table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
th { text-align: left; background: ${s.branding.appColor}; color: #fff; padding: 6pt 8pt; }
td { padding: 6pt 8pt; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
tr { break-inside: avoid; }
td.num { font-family: ui-monospace, Menlo, monospace; white-space: nowrap; font-size: 8.5pt; }
td.pg, th.pg { text-align: right; white-space: nowrap; }
.note { color: #94a3b8; font-size: 8pt; }
</style></head><body>
<section class="cover">
  ${logo}<div class="company">${e(s.branding.companyName)}</div>
  <div class="kicker">SOP Binder${lang ? ` · ${e(input.bilingual ? `English / ${lang.native}` : lang.native)}` : ''}</div>
  <h1>${e(input.title)}</h1>
  <div class="bar"></div>
  <div class="meta">${entries.length} standard operating procedure${entries.length === 1 ? '' : 's'}<br>${input.includeDrafts ? 'Includes drafts that are not approved yet' : 'Approved versions only'}<br>Printed ${e(formatDate(new Date().toISOString()))}</div>
  <div class="bottom"><img src="${qr}" alt=""><div><strong>Uncontrolled when printed.</strong><br>Scan to check you have the current version of every SOP.</div></div>
</section>
<section>
  <h2>Contents</h2>
  <table><thead><tr><th>SOP No.</th><th>Title</th><th>Rev</th><th>Effective</th><th class="pg">Page</th></tr></thead><tbody>${rows}</tbody></table>
</section>
</body></html>`;
}

export async function buildBinder(jobId: string, input: BinderInput, onProgress: (pct: number, message: string) => void) {
  const s = getSettings();
  const sops = selectSops(input);
  if (!sops.length) throw new Error(input.includeDrafts ? 'No SOPs match this selection.' : 'No approved SOPs match this selection. Turn on "Include drafts" or approve some SOPs first.');
  const entries: Entry[] = [];
  for (const [i, sop] of sops.entries()) {
    onProgress(5 + (i / sops.length) * 80, `Rendering ${sop.number} (${i + 1} of ${sops.length})`);
    const translation = input.language !== 'en' ? translationFor(sop, input.language, input.includeDrafts ? 'latest' : 'exact') : null;
    const ctx = await buildContext(sop, { mode: 'paged', purpose: 'pdf', language: input.language, bilingual: input.bilingual, translation });
    const pdf = await htmlToPdf(renderHtml(ctx), { title: sop.title, author: s.branding.companyName, subject: sop.number, keywords: [] });
    const pages = (await PDFDocument.load(pdf)).getPageCount();
    entries.push({ sop, pdf, pages, englishOnly: input.language !== 'en' && !translation, title: input.language !== 'en' && !input.bilingual && translation?.content.title ? translation.content.title : sop.title });
  }

  onProgress(88, 'Building the cover and contents');
  const qr = await qrDataUri(input.categoryId ? `${config.appUrl}/?category=${input.categoryId}` : config.appUrl);
  let front = 2;
  let frontPdf: Buffer = Buffer.alloc(0);
  for (let attempt = 0; attempt < 3; attempt++) {
    const starts: number[] = [];
    let next = front + 1;
    for (const en of entries) {
      starts.push(next);
      next += en.pages;
    }
    frontPdf = await htmlToPdf(frontMatterHtml(input, entries, starts, qr), { title: input.title, author: s.branding.companyName, subject: 'SOP Binder', keywords: [] }, { paged: false });
    const actual = (await PDFDocument.load(frontPdf)).getPageCount();
    if (actual === front) break;
    front = actual;
  }

  onProgress(94, 'Combining into one PDF');
  const out = await PDFDocument.create();
  for (const buf of [frontPdf, ...entries.map((x) => x.pdf)]) {
    const doc = await PDFDocument.load(buf);
    for (const p of await out.copyPages(doc, doc.getPageIndices())) out.addPage(p);
  }
  out.setTitle(input.title);
  out.setAuthor(s.branding.companyName);
  out.setSubject('SOP Binder');
  out.setCreator('SOP Machine');
  const file = path.join(config.exportsDir, `${jobId}.pdf`);
  await fsp.writeFile(file, await out.save());
  return { file, count: entries.length, pages: out.getPageCount() };
}

/** Binder files are kept for a day. */
export async function pruneExports() {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const f of await fsp.readdir(config.exportsDir).catch(() => [] as string[])) {
    const p = path.join(config.exportsDir, f);
    const st = await fsp.stat(p).catch(() => null);
    if (st && st.mtimeMs < cutoff) await fsp.rm(p, { force: true });
  }
}

export function binderTitle(categoryId: string | null, custom: string | undefined): string {
  if (custom?.trim()) return custom.trim();
  const cat = getCategory(categoryId);
  return cat ? `${cat.name} SOPs` : 'All SOPs';
}
