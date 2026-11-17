import { CALLOUT_META, DOC_STRINGS, FONT_OPTIONS, STATUS_LABELS, fillTokens, type DocStringKey } from '../../../shared/defaults';
import type { CalloutType, FontKey, MediaItem, SectionKey, Step, StepMedia, TemplateDesign } from '../../../shared/types';
import { escapeHtml as e, formatDate, formatDuration } from '../util';
import { fontFaceCss, fontWeights } from './assets';
import type { RenderContext } from './context';
import { mdInline, mdToHtml } from './markdown';

// ---------------------------------------------------------------------------
// Page geometry
// ---------------------------------------------------------------------------

const PAGE_SIZES: Record<TemplateDesign['page']['size'], [number, number]> = {
  Letter: [8.5, 11],
  A4: [8.27, 11.69],
  Legal: [8.5, 14],
};

const MARGINS: Record<TemplateDesign['page']['margins'], { top: number; side: number; bottom: number }> = {
  narrow: { top: 0.75, side: 0.5, bottom: 0.65 },
  normal: { top: 0.95, side: 0.75, bottom: 0.8 },
  wide: { top: 1.1, side: 1, bottom: 0.95 },
};

export function pageGeometry(design: TemplateDesign) {
  let [w, h] = PAGE_SIZES[design.page.size];
  if (design.page.orientation === 'landscape') [w, h] = [h, w];
  const m = { ...MARGINS[design.page.margins] };
  if (!design.header.enabled) m.top = Math.max(0.5, m.top - 0.3);
  if (!design.footer.enabled) m.bottom = Math.max(0.5, m.bottom - 0.25);
  return { width: w, height: h, margins: m };
}

// ---------------------------------------------------------------------------
// Icons (inline SVG so they work offline in PDF and web)
// ---------------------------------------------------------------------------

const ICONS: Record<string, string> = {
  danger:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  warning:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  caution:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  tip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.74V17h8v-2.26A7 7 0 0 0 12 2z"/></svg>',
  shield:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  tool: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fontFamily(key: FontKey): string {
  const f = FONT_OPTIONS.find((o) => o.key === key) ?? FONT_OPTIONS[0];
  return `'${f.family}', ${f.serif ? 'Georgia, serif' : 'system-ui, -apple-system, Segoe UI, Arial, sans-serif'}`;
}

function cssString(s: string) {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}

function tokens(ctx: RenderContext): Record<string, string> {
  const s = ctx.sop;
  return {
    company: ctx.settings.branding.companyName,
    title: ctx.lang.mode === 'tr' ? ctx.lang.t?.content.title || s.title : s.title,
    number: s.number,
    version: s.version,
    status: STATUS_LABELS[s.status] ?? s.status,
    category: ctx.category?.name ?? '',
    effectiveDate: formatDate(s.effectiveDate) || 'Pending approval',
    printedDate: ctx.printedDate,
  };
}

const sectionId = (key: SectionKey) => `sec-${key}`;
const stepId = (step: Step) => `step-${step.id}`;

function isEmptySection(key: SectionKey, ctx: RenderContext): boolean {
  const c = ctx.sop.content;
  switch (key) {
    case 'purpose':
      return !c.purpose.trim();
    case 'scope':
      return !c.scope.trim();
    case 'responsibilities':
      return !c.responsibilities.trim();
    case 'safety':
      return c.safety.length === 0;
    case 'tools':
      return c.tools.length === 0;
    case 'notes':
      return !c.notes.trim();
    case 'attachments':
      return c.attachments.filter((a) => ctx.media.has(a.mediaId)).length === 0;
    case 'procedure':
      return false;
    case 'toc':
      return ctx.mode === 'web';
    default:
      return false;
  }
}

function visibleSections(ctx: RenderContext) {
  return ctx.design.sections.filter((s) => s.enabled && !isEmptySection(s.key, ctx));
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

function buildCss(ctx: RenderContext): string {
  const d = ctx.design;
  const geo = pageGeometry(d);
  const paged = ctx.mode === 'paged';
  const mediaCol = { small: '34%', medium: '44%', large: '54%' }[d.steps.imageSize];
  const mediaMaxH = { small: '2.4in', medium: '3.3in', large: '4.6in' }[d.steps.imageSize];
  const stackedMaxW = { small: '55%', medium: '78%', large: '100%' }[d.steps.imageSize];
  const pageNum = d.footer.showPageNumbers ? `"Page " counter(page) " of " counter(pages)` : 'none';
  const showWatermark = d.watermark.enabled && ctx.sop.status !== 'approved';
  const wmText = ctx.sop.status === 'archived' ? 'OBSOLETE' : ctx.sop.status === 'review' ? 'IN REVIEW' : d.watermark.text || 'DRAFT';
  const r = `${d.style.cornerRadius}px`;

  const pageCss = paged
    ? `
@page {
  size: ${geo.width}in ${geo.height}in;
  margin: ${geo.margins.top}in ${geo.margins.side}in ${geo.margins.bottom}in;
  ${d.header.enabled ? '@top-center { content: element(runHeader); width: 100%; vertical-align: bottom; padding-bottom: 10pt; }' : ''}
  ${d.footer.enabled ? '@bottom-left { content: element(runFooter); width: 80%; vertical-align: top; padding-top: 8pt; }' : ''}
  ${d.footer.enabled ? `@bottom-right { content: ${pageNum}; vertical-align: top; padding-top: 8pt; font-family: ${fontFamily(d.typography.bodyFont)}; font-size: 7.5pt; color: ${d.colors.muted}; white-space: nowrap; }` : ''}
}
@page cover {
  margin: 0;
  @top-center { content: none; }
  @bottom-left { content: none; }
  @bottom-right { content: none; }
}
.cover { page: cover; width: ${geo.width}in; height: calc(${geo.height}in - 2px); break-after: page; }
.run-header { position: running(runHeader); }
.run-footer { position: running(runFooter); }
.pagedjs_margin-top-center > .pagedjs_margin-content, .pagedjs_margin-bottom-left > .pagedjs_margin-content { width: 100%; }
${showWatermark ? `.pagedjs_page:not(.pagedjs_cover_page) .pagedjs_pagebox::after { content: ${cssString(wmText)}; position: absolute; left: 0; right: 0; top: 42%; text-align: center; font-family: ${fontFamily(d.typography.headingFont)}; font-weight: 700; font-size: ${Math.round(geo.width * 13)}pt; letter-spacing: 0.05em; color: rgba(220, 38, 38, 0.07); transform: rotate(-32deg); pointer-events: none; z-index: 10; }` : ''}
.toc a::after { content: target-counter(attr(href), page); }
`
    : `
html { background: #eef0f3; }
body { margin: 0; padding: 24px 12px 64px; }
.doc { max-width: 980px; margin: 0 auto; background: #fff; padding: 40px 48px 56px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.06); }
@media (max-width: 720px) {
  body { padding: 0; }
  .doc { border-radius: 0; padding: 20px 16px 40px; box-shadow: none; }
  .web-header { flex-direction: column; align-items: flex-start; gap: 10px; }
  .web-header img.logo { max-height: 40px; }
  .web-header h1 { font-size: 18pt; }
  .layout-side .step-body.with-media { display: block !important; }
  .layout-side .step-media { margin-top: 10pt; }
  .info-grid { grid-template-columns: 1fr 1fr !important; }
  .list-grid { columns: 1 !important; }
}
`;

  return `
${fontFaceCss([d.typography.bodyFont, d.typography.headingFont])}
:root {
  --primary: ${d.colors.primary};
  --accent: ${d.colors.accent};
  --text: ${d.colors.text};
  --muted: ${d.colors.muted};
  --badge: ${d.colors.stepBadge};
  --badge-text: ${d.colors.stepBadgeText};
  --primary-soft: color-mix(in srgb, ${d.colors.primary} 7%, white);
  --primary-line: color-mix(in srgb, ${d.colors.primary} 22%, white);
  --accent-soft: color-mix(in srgb, ${d.colors.accent} 12%, white);
  --radius: ${r};
  --media-col: ${mediaCol};
  --media-max-h: ${mediaMaxH};
  --stacked-max-w: ${stackedMaxW};
  --body-font: ${fontFamily(d.typography.bodyFont)};
  --heading-font: ${fontFamily(d.typography.headingFont)};
}
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: var(--body-font); font-size: ${d.typography.baseSize}pt; line-height: ${d.typography.lineHeight}; color: var(--text); }
h1, h2, h3, h4 { font-family: var(--heading-font); color: var(--text); line-height: 1.2; margin: 0; }
p { margin: 0 0 0.55em; }
p:last-child { margin-bottom: 0; }
ul, ol { margin: 0.2em 0 0.6em; padding-left: 1.35em; }
li { margin: 0.12em 0; }
strong { font-weight: 700; }
a { color: var(--primary); }
img { max-width: 100%; }
${pageCss}

/* ---- Running header & footer ---- */
.run-header { width: 100%; padding-bottom: 5pt; border-bottom: 1.5pt solid var(--primary); font-size: 8pt; color: var(--muted); text-align: left; }
.run-header .rh { display: flex; align-items: flex-end; gap: 10pt; }
.run-header img { height: 22pt; width: auto; max-width: 1.6in; object-fit: contain; }
.run-header .rh-left { flex: 1; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.run-header .rh-right { white-space: nowrap; }
.run-footer { width: 100%; font-size: 7.5pt; color: var(--muted); line-height: 1.3; text-align: left; }
.run-footer .rf { display: flex; gap: 14pt; }
.run-footer .rf-left { flex: 1; min-width: 0; }
.run-footer .rf-center { font-weight: 600; white-space: nowrap; }

/* ---- Cover ---- */
.cover { position: relative; display: flex; flex-direction: column; overflow: hidden; }
.cover .cover-logo img { max-height: 0.9in; max-width: 2.8in; object-fit: contain; }
.cover .cover-company { font-family: var(--heading-font); font-weight: 600; font-size: 13pt; }
.cover .cover-subtitle { text-transform: uppercase; letter-spacing: 0.14em; font-size: 10pt; font-weight: 600; }
.cover h1 { font-size: 30pt; font-weight: 700; margin: 10pt 0 8pt; line-height: 1.1; }
.cover .cover-number { font-size: 13pt; font-weight: 600; letter-spacing: 0.03em; }
.cover .cover-cat { display: inline-flex; align-items: center; gap: 6pt; margin-top: 12pt; font-size: 10pt; font-weight: 600; }
.cover .cover-cat i { width: 9pt; height: 9pt; border-radius: 50%; display: inline-block; }
.cover table.cover-meta { border-collapse: collapse; font-size: 9.5pt; width: 100%; }
.cover table.cover-meta td { padding: 6pt 8pt; border-bottom: 1px solid rgba(0,0,0,.12); vertical-align: top; }
.cover table.cover-meta td.k { font-weight: 600; width: 32%; }
.cover .cover-qr { display: flex; align-items: center; gap: 10pt; font-size: 8.5pt; }
.cover .cover-qr img { width: 0.95in; height: 0.95in; background: #fff; padding: 3pt; border-radius: 4pt; }
.cover .cover-bottom { margin-top: auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 24pt; }
.cover .cover-bottom table { max-width: 4.2in; }
.cover .cover-notice { font-size: 8pt; opacity: .75; margin-top: 10pt; }

.cover-band .cover-band-top { background: var(--primary); padding: 0.55in 0.75in 0.45in; color: #fff; display: flex; align-items: center; gap: 14pt; }
.cover-band .cover-band-top .cover-logo { background: #fff; padding: 8pt 12pt; border-radius: var(--radius); }
.cover-band .cover-accent { height: 7pt; background: var(--accent); }
.cover-band .cover-main { padding: 1.1in 0.75in 0; }
.cover-band .cover-subtitle { color: var(--primary); }
.cover-band .cover-bottom { padding: 0 0.75in 0.7in; }

.cover-centered { align-items: center; text-align: center; padding: 1.1in 0.9in 0.8in; border-top: 10pt solid var(--primary); }
.cover-centered .cover-main { margin-top: 1.1in; }
.cover-centered .cover-rule { width: 1.4in; height: 3pt; background: var(--accent); margin: 14pt auto; }
.cover-centered .cover-subtitle { color: var(--primary); }
.cover-centered .cover-bottom { flex-direction: column; align-items: center; gap: 20pt; width: 100%; }
.cover-centered table.cover-meta { margin: 0 auto; text-align: left; }

.cover-full { background: var(--primary); color: #fff; padding: 0.8in; }
.cover-full h1, .cover-full .cover-company { color: #fff; }
.cover-full .cover-logo { background: #fff; padding: 10pt 14pt; border-radius: var(--radius); align-self: flex-start; }
.cover-full .cover-main { margin-top: 1.3in; border-left: 8pt solid var(--accent); padding-left: 18pt; }
.cover-full .cover-subtitle { color: var(--accent); }
.cover-full table.cover-meta td { border-bottom-color: rgba(255,255,255,.2); }

/* ---- Web header ---- */
.web-header { display: flex; gap: 18px; align-items: center; border-bottom: 3px solid var(--primary); padding-bottom: 16px; margin-bottom: 18px; }
.web-header img.logo { max-height: 52px; max-width: 160px; object-fit: contain; }
.web-header .wh-sub { text-transform: uppercase; letter-spacing: .12em; font-size: 8.5pt; font-weight: 600; color: var(--primary); }
.web-header h1 { font-size: 22pt; margin: 2px 0 4px; }
.web-header .wh-meta { color: var(--muted); font-size: 9.5pt; display: flex; flex-wrap: wrap; gap: 4px 14px; }
.status-pill { display: inline-block; padding: 1px 8px; border-radius: 99px; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
.status-approved { background: #dcfce7; color: #166534; }
.status-draft { background: #fef3c7; color: #92400e; }
.status-review { background: #dbeafe; color: #1e40af; }
.status-archived { background: #e5e7eb; color: #374151; }
.draft-banner { background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; padding: 8px 12px; border-radius: 8px; font-size: 9.5pt; margin-bottom: 16px; }

/* ---- Section headings ---- */
.section { margin: 0 0 16pt; }
.keep { break-inside: avoid; }
h2.section-title { font-size: ${(d.typography.baseSize * 1.4).toFixed(1)}pt; font-weight: 700; margin: 6pt 0 8pt; break-after: avoid; ${d.style.uppercaseHeadings ? 'text-transform: uppercase; letter-spacing: .04em;' : ''} }
.h-underline h2.section-title { color: var(--primary); padding-bottom: 4pt; border-bottom: 2pt solid var(--accent); }
.h-band h2.section-title { background: var(--primary); color: #fff; padding: 5pt 10pt; border-radius: var(--radius); }
.h-leftbar h2.section-title { color: var(--primary); border-left: 5pt solid var(--accent); padding: 2pt 0 2pt 9pt; }
.h-plain h2.section-title { color: var(--primary); }
.section-body { font-size: 1em; }

/* ---- Doc info ---- */
.info-grid { display: grid; grid-template-columns: auto 1fr auto 1fr; border: 1px solid var(--primary-line); border-radius: var(--radius); overflow: hidden; font-size: 0.9em; }
.info-grid > div { padding: 5pt 9pt; border-bottom: 1px solid var(--primary-line); }
.info-grid > div:nth-last-child(-n+4) { border-bottom: none; }
.info-grid .k { background: var(--primary-soft); font-weight: 600; color: var(--primary); white-space: nowrap; }

/* ---- TOC ---- */
.toc { list-style: none; padding: 0; margin: 0; }
.toc li { margin: 3pt 0; }
.toc li.sub { padding-left: 16pt; font-size: .92em; }
.toc a { display: flex; gap: 6pt; color: var(--text); text-decoration: none; }
.toc a .dots { flex: 1; border-bottom: 1px dotted #9ca3af; margin-bottom: 4pt; }
.toc a::after { color: var(--muted); }

/* ---- Safety & tools ---- */
.safety-box { border: 1px solid color-mix(in srgb, var(--accent) 55%, white); background: var(--accent-soft); border-radius: var(--radius); padding: 9pt 12pt; }
.list-grid { columns: 2; column-gap: 18pt; list-style: none; padding: 0; margin: 0; }
.list-grid li { display: flex; gap: 7pt; align-items: flex-start; break-inside: avoid; margin: 0 0 4pt; }
.list-grid li svg { width: 12pt; height: 12pt; flex: none; margin-top: 1.5pt; }
.safety-box li svg { color: color-mix(in srgb, var(--accent) 70%, black); }
.tools li svg { color: var(--primary); }

/* ---- Steps ---- */
.phase { font-size: ${(d.typography.baseSize * 1.15).toFixed(1)}pt; color: var(--primary); font-weight: 700; margin: 14pt 0 8pt; padding-bottom: 3pt; border-bottom: 1px solid var(--primary-line); break-after: avoid; }
.step { margin: 0 0 12pt; ${d.steps.keepTogether ? 'break-inside: avoid;' : ''} }
${d.steps.showDividers ? '.step + .step { border-top: 1px solid #e5e7eb; padding-top: 12pt; }' : ''}
.step-head { display: flex; align-items: center; gap: 9pt; margin-bottom: 6pt; break-after: avoid; }
.step-title { font-size: ${(d.typography.baseSize * 1.12).toFixed(1)}pt; font-weight: 700; }
.step-num { flex: none; font-family: var(--heading-font); font-weight: 700; }
.s-badge .step-num { width: 22pt; height: 22pt; border-radius: 50%; background: var(--badge); color: var(--badge-text); display: inline-flex; align-items: center; justify-content: center; font-size: 10.5pt; box-shadow: 0 0 0 2.5pt var(--accent-soft); }
.s-label .step-head { flex-direction: column; align-items: flex-start; gap: 1pt; }
.s-label .step-num { font-size: 8pt; letter-spacing: .12em; text-transform: uppercase; color: var(--badge-text); background: var(--badge); padding: 1pt 6pt; border-radius: 3pt; }
.s-card .step { border: 1px solid #e5e7eb; border-top: 3pt solid var(--primary); border-radius: var(--radius); padding: 10pt 12pt; }
.s-card .step + .step { border-top: 3pt solid var(--primary); padding-top: 10pt; }
.s-card .step-num { min-width: 22pt; height: 22pt; padding: 0 5pt; border-radius: var(--radius); background: var(--badge); color: var(--badge-text); display: inline-flex; align-items: center; justify-content: center; font-size: 10.5pt; }
.step-body.with-media { display: grid; gap: 14pt; align-items: start; }
.layout-side .step-body.with-media { grid-template-columns: minmax(0, 1fr) var(--media-col); }
.layout-side.img-left .step-body.with-media { grid-template-columns: var(--media-col) minmax(0, 1fr); }
.layout-side.img-left .step-media { order: -1; }
.layout-stacked .step-body.with-media { grid-template-columns: minmax(0, 1fr); }
.step-text { min-width: 0; }
.step-media { display: grid; gap: 8pt; }
.layout-side .step-media.many { grid-template-columns: 1fr 1fr; }
.layout-stacked .step-media { grid-template-columns: repeat(auto-fit, minmax(2.4in, 1fr)); }
.layout-stacked .step-media.single { grid-template-columns: 1fr; justify-items: center; }
.layout-stacked .step-media.single figure { width: var(--stacked-max-w); }
figure { margin: 0; break-inside: avoid; }
figure img.media { display: block; width: 100%; height: auto; max-height: var(--media-max-h); object-fit: contain; margin: 0 auto; ${d.steps.imageBorder ? 'border: 1px solid #d1d5db;' : ''} border-radius: var(--radius); background: #fff; }
figure video { display: block; width: 100%; max-height: 70vh; border-radius: var(--radius); background: #000; }
figcaption { font-size: .82em; color: var(--muted); text-align: center; margin-top: 3pt; }
.video-card { border: 1px solid #d1d5db; border-radius: var(--radius); overflow: hidden; background: #fff; }
.video-card .poster { position: relative; }
.video-card .poster img { display: block; width: 100%; height: auto; max-height: var(--media-max-h); object-fit: cover; }
.video-card .poster .play { position: absolute; inset: 0; margin: auto; width: 34pt; height: 34pt; border-radius: 50%; background: rgba(0,0,0,.6); color: #fff; display: flex; align-items: center; justify-content: center; }
.video-card .poster .play svg { width: 15pt; height: 15pt; margin-left: 3pt; }
.video-card .video-qr { display: flex; align-items: center; gap: 8pt; padding: 6pt 8pt; font-size: .8em; color: var(--muted); }
.video-card .video-qr img { width: 0.75in; height: 0.75in; }
.video-card .video-qr strong { color: var(--text); }

/* ---- Callouts ---- */
.callout { display: flex; gap: 8pt; padding: 7pt 10pt; border-radius: var(--radius); margin: 7pt 0 2pt; break-inside: avoid; }
.callout svg { width: 15pt; height: 15pt; flex: none; margin-top: 1pt; }
.callout .c-label { font-weight: 800; font-size: .8em; letter-spacing: .08em; }
.callout .c-text { font-size: .95em; }
${(Object.keys(CALLOUT_META) as (keyof typeof CALLOUT_META)[])
  .map((k) => {
    const m = CALLOUT_META[k];
    return d.style.calloutStyle === 'filled'
      ? `.callout-${k} { background: ${m.bg}; border-left: 4pt solid ${m.color}; } .callout-${k} svg, .callout-${k} .c-label { color: ${m.color}; }`
      : `.callout-${k} { background: #fff; border: 1.5pt solid ${m.color}; } .callout-${k} svg, .callout-${k} .c-label { color: ${m.color}; }`;
  })
  .join('\n')}

/* ---- Tables ---- */
table.md-table { width: 100%; border-collapse: collapse; margin: 4pt 0 8pt; font-size: .94em; }
table.md-table th, table.md-table td { border: 1px solid #94a3b8; padding: 4pt 6pt; text-align: left; vertical-align: top; }
table.md-table th { background: color-mix(in srgb, var(--primary) 12%, white); font-weight: 600; }
table.md-table tr { break-inside: avoid; }
table.data { width: 100%; border-collapse: collapse; font-size: .88em; }
table.data th { background: var(--primary); color: #fff; text-align: left; padding: 5pt 8pt; font-weight: 600; }
table.data td { padding: 5pt 8pt; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
table.data tr:nth-child(even) td { background: #f9fafb; }
table.sign td { height: 26pt; }
.attachments { display: grid; grid-template-columns: repeat(auto-fill, minmax(2.6in, 1fr)); gap: 12pt; }
.muted { color: var(--muted); }

/* ---- Bilingual ---- */
.bi { font-weight: 500; opacity: .8; }
.bi-title { display: block; font-size: .8em; font-weight: 600; font-style: italic; opacity: .75; margin-top: 1pt; }
.bi-block { margin-top: 3pt; padding-left: 7pt; border-left: 2pt solid var(--accent); color: color-mix(in srgb, var(--text) 78%, var(--primary)); font-style: italic; }
.bi-block p { margin-bottom: .35em; }
.bi-line { display: block; font-style: italic; opacity: .8; font-size: .95em; }
.h-band h2.section-title .bi-title { color: #fff; }
.cover-full .bi-title, .cover-full .bi { color: #fff; }
[dir="rtl"] .bi-block { padding-left: 0; padding-right: 7pt; border-left: none; border-right: 2pt solid var(--accent); }
`;
}

// ---------------------------------------------------------------------------
// Language helpers: English, translated, or bilingual (English with translation under it)
// ---------------------------------------------------------------------------

const langAttr = (ctx: RenderContext) => `lang="${e(ctx.lang.code)}"${ctx.lang.rtl ? ' dir="rtl"' : ''}`;

/** Plain text in the current language mode (for tokens and attributes). */
function txt(ctx: RenderContext, en: string, tr: string | undefined): string {
  if (ctx.lang.mode === 'tr') return tr?.trim() ? tr : en;
  if (ctx.lang.mode === 'bi' && tr?.trim() && tr !== en) return `${en} / ${tr}`;
  return en;
}

/** Escaped short label; bilingual shows "English / Translation". */
function lbl(ctx: RenderContext, en: string, tr: string | undefined): string {
  if (ctx.lang.mode === 'tr') return e(tr?.trim() ? tr : en);
  if (ctx.lang.mode === 'bi' && tr?.trim() && tr !== en) return `${e(en)}<span class="bi" ${langAttr(ctx)}> / ${e(tr)}</span>`;
  return e(en);
}

const docStr = (ctx: RenderContext, key: DocStringKey) => lbl(ctx, DOC_STRINGS[key], ctx.lang.t?.strings[key]);
const docTxt = (ctx: RenderContext, key: DocStringKey) => txt(ctx, DOC_STRINGS[key], ctx.lang.t?.strings[key]);

/** Markdown block; bilingual puts the translation underneath in a marked block. */
function block(ctx: RenderContext, en: string, tr: string | undefined): string {
  if (ctx.lang.mode === 'tr') return mdToHtml(tr?.trim() ? tr : en);
  if (ctx.lang.mode === 'bi' && tr?.trim()) return `${mdToHtml(en)}<div class="bi-block" ${langAttr(ctx)}>${mdToHtml(tr)}</div>`;
  return mdToHtml(en);
}

/** Inline markdown (list items, captions). */
function inline(ctx: RenderContext, en: string, tr: string | undefined): string {
  if (ctx.lang.mode === 'tr') return mdInline(tr?.trim() ? tr : en);
  if (ctx.lang.mode === 'bi' && tr?.trim()) return `${mdInline(en)}<span class="bi-line" ${langAttr(ctx)}>${mdInline(tr)}</span>`;
  return mdInline(en);
}

/** Headings: bilingual adds a smaller translated line. */
function heading(ctx: RenderContext, en: string, tr: string | undefined): string {
  if (ctx.lang.mode === 'tr') return e(tr?.trim() ? tr : en);
  if (ctx.lang.mode === 'bi' && tr?.trim() && tr !== en) return `${e(en)}<span class="bi-title" ${langAttr(ctx)}>${e(tr)}</span>`;
  return e(en);
}

const trContent = (ctx: RenderContext) => ctx.lang.t?.content ?? null;
const trStep = (ctx: RenderContext, id: string) => trContent(ctx)?.steps.find((s) => s.id === id);

function statusLabel(ctx: RenderContext): string {
  const key = ({ draft: 'statusDraft', review: 'statusReview', approved: 'statusApproved', archived: 'statusArchived' } as const)[ctx.sop.status];
  return docTxt(ctx, key);
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function logoImg(ctx: RenderContext, cls = '') {
  if (!ctx.settings.branding.logoMediaId) return '';
  return `<img class="${cls}" src="/api/public/logo?v=${e(ctx.settings.branding.logoMediaId)}" alt="${e(ctx.settings.branding.companyName)}">`;
}

const mediaSrc = (ctx: RenderContext, id: string, variant: string) => `${ctx.mediaBase}/${id}/${variant}`;

function imgTag(m: MediaItem, ctx: RenderContext, alt: string) {
  const variant = ctx.settings.export.imageQuality === 'high' && ctx.purpose === 'pdf' ? 'display-hq' : 'display';
  const dims = m.width && m.height ? ` width="${m.width}" height="${m.height}"` : '';
  return `<img class="media" src="${mediaSrc(ctx, m.id, variant)}"${dims} alt="${e(alt)}" loading="${ctx.mode === 'web' ? 'lazy' : 'eager'}">`;
}

function renderFigure(item: StepMedia, ctx: RenderContext, trCaption?: string): string {
  const m = ctx.media.get(item.mediaId);
  if (!m) return '';
  const caption = item.caption ? `<figcaption>${inline(ctx, item.caption, trCaption)}</figcaption>` : '';
  if (m.kind === 'image') {
    return `<figure>${imgTag(m, ctx, item.caption)}${caption}</figure>`;
  }
  // Video
  if (ctx.mode === 'web') {
    const dims = m.width && m.height ? ` width="${m.width}" height="${m.height}"` : '';
    return `<figure id="media-${m.id}"><video controls preload="metadata" playsinline poster="${mediaSrc(ctx, m.id, 'poster')}"${dims}><source src="${mediaSrc(ctx, m.id, 'file')}" type="${e(m.mime)}"></video>${caption}</figure>`;
  }
  const handling = ctx.settings.export.videoHandling;
  if (handling === 'omit') return '';
  const qr = ctx.videoQrs.get(m.id);
  const dur = formatDuration(m.duration);
  return `<figure><div class="video-card"><div class="poster"><img src="${mediaSrc(ctx, m.id, 'poster')}" alt="Video"><span class="play">${ICONS.play}</span></div>${
    handling === 'qr' && qr
      ? `<div class="video-qr"><img src="${qr}" alt="QR code"><div><strong>${docStr(ctx, 'scanVideo')}</strong>${dur ? `<br>${docStr(ctx, 'length')} ${dur}` : ''}</div></div>`
      : `<div class="video-qr"><div><strong>${docStr(ctx, 'video')}${dur ? ` (${dur})` : ''}</strong><br>${docStr(ctx, 'openDigital')}</div></div>`
  }</div>${caption}</figure>`;
}

function renderCallout(ctx: RenderContext, type: CalloutType, text: string, tr: string | undefined) {
  if (type === 'none' || !text.trim()) return '';
  return `<div class="callout callout-${type}">${ICONS[type]}<div><div class="c-label">${docStr(ctx, type)}</div><div class="c-text">${block(ctx, text, tr)}</div></div></div>`;
}

/** Steps as printable blocks. A phase heading is glued to the step after it so it never ends a page. */
function stepBlocks(ctx: RenderContext): string[] {
  let n = 0;
  const blocks: string[] = [];
  let pendingPhase = '';
  for (const step of ctx.sop.content.steps) {
    const t = trStep(ctx, step.id);
    if (step.kind === 'section') {
      pendingPhase += `<h3 class="phase" id="${stepId(step)}">${heading(ctx, step.title || 'Section', t?.title)}</h3>`;
      continue;
    }
    n += 1;
    const figures = step.media.map((m, i) => renderFigure(m, ctx, t?.captions[i])).filter(Boolean);
    const mediaCls = figures.length === 1 ? 'single' : figures.length > 2 ? 'many' : '';
    const stepWord = ctx.lang.mode === 'tr' ? docTxt(ctx, 'step') : DOC_STRINGS.step;
    const html = `<div class="step" id="${stepId(step)}">
  <div class="step-head"><span class="step-num">${ctx.design.style.stepStyle === 'label' ? `${e(stepWord)} ${n}` : n}</span><h3 class="step-title">${heading(ctx, step.title || `Step ${n}`, t?.title)}</h3></div>
  <div class="step-body${figures.length ? ' with-media' : ''}">
    <div class="step-text">${block(ctx, step.body, t?.body)}${renderCallout(ctx, step.callout.type, step.callout.text, t?.callout)}</div>
    ${figures.length ? `<div class="step-media ${mediaCls}">${figures.join('')}</div>` : ''}
  </div>
</div>`;
    blocks.push(pendingPhase ? `<div class="keep">${pendingPhase}${html}</div>` : html);
    pendingPhase = '';
  }
  if (pendingPhase) blocks.push(pendingPhase);
  if (!blocks.length) blocks.push(`<p class="muted">${docStr(ctx, 'noSteps')}</p>`);
  return blocks;
}

/** Sections short enough to always keep on one page with their heading. */
const KEEP_SECTIONS = new Set<SectionKey>(['docInfo', 'safety', 'tools', 'approvals']);

function infoRows(ctx: RenderContext): [string, string][] {
  const s = ctx.sop;
  return [
    [docStr(ctx, 'docNo'), e(s.number)],
    [docStr(ctx, 'version'), e(s.version)],
    [docStr(ctx, 'status'), e(statusLabel(ctx))],
    [docStr(ctx, 'category'), e(ctx.category?.name ?? '—')],
    [docStr(ctx, 'effectiveDate'), e(formatDate(s.effectiveDate) || docTxt(ctx, 'onApproval'))],
    [docStr(ctx, 'nextReview'), e(formatDate(s.reviewDate) || '—')],
    [docStr(ctx, 'owner'), e(s.owner || '—')],
    [docStr(ctx, 'approver'), e(s.approver || '—')],
  ];
}

const sectionLabel = (ctx: RenderContext, key: SectionKey, en: string) => heading(ctx, en, ctx.lang.t?.strings[`section.${key}`]);

function renderSection(key: SectionKey, label: string, ctx: RenderContext): string {
  const c = ctx.sop.content;
  const t = trContent(ctx);
  const title = `<h2 class="section-title">${sectionLabel(ctx, key, label)}</h2>`;
  const wrap = (body: string, keep = KEEP_SECTIONS.has(key) || body.length < 1500) =>
    `<section class="section sec-${key}${keep ? ' keep' : ''}" id="${sectionId(key)}">${title}<div class="section-body">${body}</div></section>`;
  switch (key) {
    case 'docInfo':
      return wrap(`<div class="info-grid">${infoRows(ctx).map(([k, v]) => `<div class="k">${k}</div><div>${v}</div>`).join('')}</div>`);
    case 'toc': {
      const items: string[] = [];
      for (const s of visibleSections(ctx)) {
        if (s.key === 'toc' || s.key === 'docInfo') continue;
        items.push(`<li><a href="#${sectionId(s.key)}"><span>${e(txt(ctx, s.label, ctx.lang.t?.strings[`section.${s.key}`]))}</span><span class="dots"></span></a></li>`);
        if (s.key === 'procedure') {
          let n = 0;
          for (const st of c.steps) {
            const stTitle = ctx.lang.mode === 'tr' ? trStep(ctx, st.id)?.title || st.title : st.title;
            const lineLabel = st.kind === 'section' ? stTitle : `${++n}. ${stTitle || `Step ${n}`}`;
            items.push(`<li class="sub"><a href="#${stepId(st)}"><span>${e(lineLabel)}</span><span class="dots"></span></a></li>`);
          }
        }
      }
      return wrap(`<ol class="toc">${items.join('')}</ol>`);
    }
    case 'purpose':
    case 'scope':
    case 'responsibilities':
    case 'notes':
      return wrap(block(ctx, c[key], t?.[key]));
    case 'safety':
      return wrap(`<div class="safety-box"><ul class="list-grid">${c.safety.map((x, i) => `<li>${ICONS.shield}<span>${inline(ctx, x, t?.safety[i])}</span></li>`).join('')}</ul></div>`);
    case 'tools':
      return wrap(`<ul class="list-grid tools">${c.tools.map((x, i) => `<li>${ICONS.tool}<span>${inline(ctx, x, t?.tools[i])}</span></li>`).join('')}</ul>`);
    case 'procedure': {
      const [first, ...rest] = stepBlocks(ctx);
      return `<section class="section sec-procedure" id="${sectionId(key)}"><div class="keep">${title}${first}</div>${rest.join('\n')}</section>`;
    }
    case 'attachments':
      return wrap(`<div class="attachments">${c.attachments.map((a, i) => renderFigure(a, ctx, t?.attachments[i])).join('')}</div>`);
    case 'revisions': {
      const rows = ctx.revisions.length
        ? ctx.revisions.map((r) => `<tr><td>${e(r.version)}</td><td>${e(formatDate(r.createdAt))}</td><td>${e(r.summary)}</td><td>${e(r.createdByName ?? '')}</td></tr>`).join('')
        : `<tr><td>${e(ctx.sop.version)}</td><td>—</td><td>${docStr(ctx, 'initialRelease')}</td><td></td></tr>`;
      return wrap(
        `<table class="data"><thead><tr><th style="width:12%">${docStr(ctx, 'version')}</th><th style="width:18%">${docStr(ctx, 'revDate')}</th><th>${docStr(ctx, 'revChange')}</th><th style="width:22%">${docStr(ctx, 'revApprovedBy')}</th></tr></thead><tbody>${rows}</tbody></table>`,
      );
    }
    case 'approvals': {
      const rows: [string, string][] = [
        [docStr(ctx, 'preparedBy'), ctx.sop.owner],
        [docStr(ctx, 'reviewedBy'), ''],
        [docStr(ctx, 'approvedBy'), ctx.sop.approver],
      ];
      return wrap(
        `<table class="data sign"><thead><tr><th style="width:20%">${docStr(ctx, 'role')}</th><th style="width:30%">${docStr(ctx, 'name')}</th><th>${docStr(ctx, 'signature')}</th><th style="width:18%">${docStr(ctx, 'date')}</th></tr></thead><tbody>${rows
          .map(([role, name]) => `<tr><td>${role}</td><td>${e(name)}</td><td></td><td></td></tr>`)
          .join('')}</tbody></table>`,
      );
    }
  }
}

function renderCover(ctx: RenderContext): string {
  const d = ctx.design;
  const s = ctx.sop;
  const tTitle = trContent(ctx)?.title;
  const cat = ctx.category ? `<div class="cover-cat"><i style="background:${e(ctx.category.color)}"></i>${e(ctx.category.name)}</div>` : '';
  const meta = `<table class="cover-meta">${(
    [
      ['version', e(s.version)],
      ['status', e(statusLabel(ctx))],
      ['effectiveDate', e(formatDate(s.effectiveDate) || docTxt(ctx, 'onApproval'))],
      ['nextReview', e(formatDate(s.reviewDate) || '—')],
      ['owner', e(s.owner || '—')],
      ['approver', e(s.approver || '—')],
    ] as [DocStringKey, string][]
  )
    .map(([k, v]) => `<tr><td class="k">${docStr(ctx, k)}</td><td>${v}</td></tr>`)
    .join('')}</table>`;
  const qr = ctx.sopQr
    ? `<div class="cover-qr"><img src="${ctx.sopQr}" alt="QR code"><div><strong>${docStr(ctx, 'scanLatest')}</strong><br>${e(ctx.sopUrl.replace(/^https?:\/\//, ''))}</div></div>`
    : '';
  const logo = logoImg(ctx);
  const company = `<div class="cover-company">${e(ctx.settings.branding.companyName)}</div>`;
  const subtitle = lbl(ctx, d.cover.subtitle, ctx.lang.t?.strings['cover.subtitle']);
  const h1 = heading(ctx, s.title, tTitle);
  const titleBlock = `<div class="cover-subtitle">${subtitle}</div><h1>${h1}</h1><div class="cover-number">${e(s.number)}</div>${cat}`;

  if (d.cover.style === 'band') {
    return `<section class="cover cover-band">
  <div class="cover-band-top">${logo ? `<div class="cover-logo">${logo}</div>` : ''}${company}</div>
  <div class="cover-accent"></div>
  <div class="cover-main">${titleBlock}</div>
  <div class="cover-bottom">${meta}${qr}</div>
</section>`;
  }
  if (d.cover.style === 'centered') {
    return `<section class="cover cover-centered">
  ${logo ? `<div class="cover-logo">${logo}</div>` : ''}${company}
  <div class="cover-main"><div class="cover-subtitle">${subtitle}</div><h1>${h1}</h1><div class="cover-rule"></div><div class="cover-number">${e(s.number)}</div>${cat}</div>
  <div class="cover-bottom">${meta}${qr}</div>
</section>`;
  }
  return `<section class="cover cover-full">
  ${logo ? `<div class="cover-logo">${logo}</div>` : company}
  <div class="cover-main">${titleBlock}</div>
  <div class="cover-bottom">${meta}${qr}</div>
</section>`;
}

function renderWebHeader(ctx: RenderContext): string {
  const s = ctx.sop;
  const logo = logoImg(ctx, 'logo');
  const banner =
    s.status !== 'approved'
      ? `<div class="draft-banner"><strong>${e(STATUS_LABELS[s.status] ?? s.status)}:</strong> ${
          s.status === 'archived'
            ? 'this SOP is obsolete and should not be used.'
            : s.publishedVersion
              ? `you are viewing working version ${e(s.version)}. The approved version is ${e(s.publishedVersion)}.`
              : 'this SOP has not been approved yet.'
        }</div>`
      : '';
  return `<header class="web-header">${logo}<div><div class="wh-sub">${lbl(ctx, ctx.design.cover.subtitle, ctx.lang.t?.strings['cover.subtitle'])}${ctx.category ? ` · ${e(ctx.category.name)}` : ''}</div><h1>${heading(ctx, s.title, trContent(ctx)?.title)}</h1>
<div class="wh-meta"><span>${e(s.number)}</span><span>Rev ${e(s.version)}</span><span class="status-pill status-${s.status}">${e(statusLabel(ctx))}</span>${
    s.effectiveDate ? `<span>${docStr(ctx, 'effectiveDate')}: ${e(formatDate(s.effectiveDate))}</span>` : ''
  }${s.owner ? `<span>${docStr(ctx, 'owner')}: ${e(s.owner)}</span>` : ''}</div></div></header>${banner}`;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export function renderHtml(ctx: RenderContext): string {
  const d = ctx.design;
  const t = tokens(ctx);
  const paged = ctx.mode === 'paged';
  const bodyClasses = [
    `mode-${ctx.mode}`,
    `lang-${ctx.lang.mode}`,
    `h-${d.style.headingStyle}`,
    `s-${d.style.stepStyle}`,
    d.steps.layout === 'side-by-side' ? 'layout-side' : 'layout-stacked',
    d.steps.imagePosition === 'left' ? 'img-left' : 'img-right',
  ].join(' ');

  const fontsToLoad = [d.typography.bodyFont, d.typography.headingFont].flatMap((k) => {
    const fam = FONT_OPTIONS.find((f) => f.key === k)?.family ?? 'Inter';
    return fontWeights(k)
      .filter((w) => [400, 600, 700].includes(w))
      .map((w) => `${w} 12px "${fam}"`);
  });

  const strings = ctx.lang.t?.strings ?? {};
  const footerLeft = txt(ctx, fillTokens(d.footer.left, t), strings['footer.left'] ? fillTokens(strings['footer.left'], t) : undefined);
  const footerCenter = txt(ctx, fillTokens(d.footer.center, t), strings['footer.center'] ? fillTokens(strings['footer.center'], t) : undefined);
  const runHeader =
    paged && d.header.enabled
      ? `<div class="run-header"><div class="rh">${d.header.showLogo ? logoImg(ctx) : ''}<span class="rh-left">${e(fillTokens(d.header.left, t))}</span><span class="rh-right">${e(fillTokens(d.header.right, t))}</span></div></div>`
      : '';
  const runFooter =
    paged && d.footer.enabled ? `<div class="run-footer"><div class="rf"><span class="rf-left">${e(footerLeft)}</span><span class="rf-center">${e(footerCenter)}</span></div></div>` : '';

  const sections = visibleSections(ctx)
    .map((s) => renderSection(s.key, s.label, ctx))
    .join('\n');

  const scripts = paged
    ? `<script src="/render-assets/paged-config.js"></script>${
        ctx.purpose === 'preview' ? '<script src="/render-assets/paged-preview.js"></script>' : ''
      }<script src="/render-assets/paged.polyfill.js"></script>`
    : '';
  const docLang = ctx.lang.mode === 'tr' ? ctx.lang.code : 'en';
  const docDir = ctx.lang.mode === 'tr' && ctx.lang.rtl ? ' dir="rtl"' : '';

  return `<!doctype html>
<html lang="${e(docLang)}"${docDir}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="sop-fonts" content="${e(fontsToLoad.join('|'))}">
<title>${e(`${ctx.sop.number} ${t.title}`)}</title>
<style>${buildCss(ctx)}</style>
${scripts}
</head>
<body class="${bodyClasses}">
${paged && d.cover.enabled ? renderCover(ctx) : ''}
<main class="doc">
${runHeader}${runFooter}
${paged ? '' : renderWebHeader(ctx)}
${sections}
</main>
</body>
</html>`;
}
