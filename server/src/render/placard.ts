import type { Sop, Station } from '../../../shared/types';
import { getSettings } from '../services/settings';
import { stationSops, stationSopUrl, stationUrl } from '../services/stations';
import { escapeHtml as e } from '../util';
import { fontFaceCss } from './assets';
import { qrDataUri, sopUrl } from './context';
import { htmlToPdf } from './pdf';

export type PlacardSize = 'letter' | 'half' | 'card';

const SIZES: Record<PlacardSize, { w: number; h: number; scale: number }> = {
  letter: { w: 8.5, h: 11, scale: 1 },
  half: { w: 5.5, h: 8.5, scale: 0.68 },
  card: { w: 4, h: 6, scale: 0.5 },
};

function page(size: PlacardSize, body: string, accent: string) {
  const s = SIZES[size];
  const px = (n: number) => `${(n * s.scale).toFixed(1)}pt`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaceCss(['inter'])}
@page { size: ${s.w}in ${s.h}in; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Inter', Arial, sans-serif; color: #111827; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.card { width: ${s.w}in; height: calc(${s.h}in - 1px); padding: ${(0.45 * s.scale + 0.12).toFixed(2)}in; display: flex; flex-direction: column; align-items: center; text-align: center; border-top: ${px(18)} solid ${accent}; }
.brand { display: flex; align-items: center; gap: ${px(10)}; font-weight: 600; font-size: ${px(15)}; color: #334155; }
.brand img { max-height: ${px(46)}; max-width: ${(2.4 * s.scale + 0.6).toFixed(2)}in; object-fit: contain; }
.kicker { margin-top: ${px(26)}; text-transform: uppercase; letter-spacing: .16em; font-size: ${px(13)}; font-weight: 700; color: ${accent}; }
h1 { font-size: ${px(40)}; line-height: 1.08; margin: ${px(8)} 0 ${px(4)}; }
.sub { font-size: ${px(16)}; color: #475569; }
.qr { margin: ${px(22)} 0 ${px(10)}; width: ${(4.2 * s.scale + 0.4).toFixed(2)}in; height: ${(4.2 * s.scale + 0.4).toFixed(2)}in; }
.scan { font-size: ${px(20)}; font-weight: 700; }
.scan2 { font-size: ${px(13)}; color: #475569; margin-top: ${px(4)}; }
ul { list-style: none; padding: 0; margin: ${px(18)} 0 0; width: 100%; text-align: left; font-size: ${px(13)}; border-top: 1px solid #e5e7eb; }
li { padding: ${px(5)} 0; border-bottom: 1px solid #f1f5f9; display: flex; gap: ${px(10)}; }
li b { font-family: ui-monospace, Menlo, monospace; font-size: ${px(11)}; color: #475569; white-space: nowrap; }
.foot { margin-top: auto; font-size: ${px(11)}; color: #64748b; padding-top: ${px(10)}; }
</style></head><body>${body}</body></html>`;
}

function brand() {
  const s = getSettings();
  const logo = s.branding.logoMediaId ? `<img src="/api/public/logo" alt="">` : '';
  return `<div class="brand">${logo}<span>${e(s.branding.companyName)}</span></div>`;
}

export async function stationPlacard(station: Station, size: PlacardSize): Promise<Buffer> {
  const s = getSettings();
  const sops = stationSops(station);
  const max = size === 'card' ? 4 : size === 'half' ? 7 : 12;
  const qr = await qrDataUri(stationUrl(station));
  const list = sops.length
    ? `<ul>${sops
        .slice(0, max)
        .map((x) => `<li><b>${e(x.number)}</b><span>${e(x.title)}</span></li>`)
        .join('')}${sops.length > max ? `<li><span>+ ${sops.length - max} more</span></li>` : ''}</ul>`
    : '';
  const body = `<div class="card">${brand()}
  <div class="kicker">Standard Operating Procedures</div>
  <h1>${e(station.name)}</h1>${station.area ? `<div class="sub">${e(station.area)}</div>` : ''}
  <img class="qr" src="${qr}" alt="QR code">
  <div class="scan">Scan for the current SOPs</div>
  <div class="scan2">${s.training.enabled ? 'Read the procedure and sign off on your phone' : 'Always opens the latest approved version'}</div>
  ${list}
  <div class="foot">Always shows the latest approved version. Printed copies may be out of date.</div>
</div>`;
  return htmlToPdf(page(size, body, s.branding.appColor), { title: `${station.name} QR placard`, author: s.branding.companyName, subject: 'QR placard', keywords: [] }, { paged: false });
}

export async function sopPlacard(sop: Sop, station: Station | null, size: PlacardSize): Promise<Buffer> {
  const s = getSettings();
  const url = station ? stationSopUrl(station, sop.id) : sopUrl(sop.id);
  const qr = await qrDataUri(url);
  const body = `<div class="card">${brand()}
  <div class="kicker">${e(sop.number)}${station ? ` · ${e(station.name)}` : ''}</div>
  <h1>${e(sop.title)}</h1>
  <img class="qr" src="${qr}" alt="QR code">
  <div class="scan">Scan to open this SOP</div>
  <div class="scan2">${station ? (s.training.enabled ? 'Read it, then sign off or run the checklist' : 'Always the current approved version') : 'Sign in required'}</div>
  <div class="foot">Always opens the latest approved version.</div>
</div>`;
  return htmlToPdf(page(size, body, s.branding.appColor), { title: `${sop.number} QR placard`, author: s.branding.companyName, subject: 'QR placard', keywords: [] }, { paged: false });
}
