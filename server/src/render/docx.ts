import fs from 'node:fs/promises';
import sharp from 'sharp';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableOfContents,
  TableRow,
  TabStopType,
  TextRun,
  VerticalAlign,
  WidthType,
  convertInchesToTwip,
  type ISectionOptions,
  type ParagraphChild,
} from 'docx';
import type { Token, Tokens } from 'marked';
import { CALLOUT_META, STATUS_LABELS, fillTokens } from '../../../shared/defaults';
import type { CalloutType, MediaItem, StepMedia } from '../../../shared/types';
import { ensureVariant, findMedia } from '../services/media';
import { formatDate, formatDuration } from '../util';
import { type RenderContext, videoUrl } from './context';
import { pageGeometry } from './html';
import { mdLexer } from './markdown';

const hex = (c: string) => c.replace('#', '').toUpperCase().padEnd(6, '0').slice(0, 6);
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER };
const thin = (color = 'D1D5DB') => ({ style: BorderStyle.SINGLE, size: 4, color });

interface Img {
  data: Buffer;
  type: 'png' | 'jpg';
  width: number;
  height: number;
}

class WordBuilder {
  private numberedInstance = 0;
  readonly font: string;
  readonly size: number; // half-points
  readonly primary: string;
  readonly accent: string;
  readonly text: string;
  readonly muted: string;
  readonly contentWidthPx: number;

  constructor(private ctx: RenderContext) {
    const d = ctx.design;
    this.font = d.word.font || 'Calibri';
    this.size = Math.round(d.typography.baseSize * 2);
    this.primary = hex(d.colors.primary);
    this.accent = hex(d.colors.accent);
    this.text = hex(d.colors.text);
    this.muted = hex(d.colors.muted);
    const geo = pageGeometry(d);
    this.contentWidthPx = Math.round((geo.width - geo.margins.side * 2) * 96);
  }

  // -------------------------------------------------------------------------
  // Markdown → paragraphs
  // -------------------------------------------------------------------------

  inline(tokens: Token[] | undefined, style: { bold?: boolean; italics?: boolean; color?: string; size?: number } = {}): ParagraphChild[] {
    const out: ParagraphChild[] = [];
    for (const t of tokens ?? []) {
      switch (t.type) {
        case 'strong':
          out.push(...this.inline((t as Tokens.Strong).tokens, { ...style, bold: true }));
          break;
        case 'em':
          out.push(...this.inline((t as Tokens.Em).tokens, { ...style, italics: true }));
          break;
        case 'codespan':
          out.push(new TextRun({ text: (t as Tokens.Codespan).text, font: 'Consolas', ...style }));
          break;
        case 'br':
          out.push(new TextRun({ text: '', break: 1 }));
          break;
        case 'link': {
          const l = t as Tokens.Link;
          if (/^https?:|^mailto:/i.test(l.href)) {
            out.push(
              new ExternalHyperlink({
                link: l.href,
                children: [new TextRun({ text: l.text, style: 'Hyperlink', ...style })],
              }),
            );
          } else out.push(new TextRun({ text: l.text, ...style }));
          break;
        }
        case 'text':
        case 'escape':
        case 'html':
        case 'del': {
          const tt = t as Tokens.Text;
          if (tt.tokens?.length) out.push(...this.inline(tt.tokens, style));
          else out.push(new TextRun({ text: decodeEntities(tt.text), ...style }));
          break;
        }
        default:
          if ('text' in t && typeof t.text === 'string') out.push(new TextRun({ text: decodeEntities(t.text), ...style }));
      }
    }
    return out;
  }

  markdown(text: string, opts: { color?: string; indent?: number } = {}): Paragraph[] {
    const paras: Paragraph[] = [];
    const style = opts.color ? { color: opts.color } : {};
    const walkList = (list: Tokens.List, level: number) => {
      const instance = list.ordered ? ++this.numberedInstance : undefined;
      for (const item of list.items) {
        const children: ParagraphChild[] = [];
        const nested: Tokens.List[] = [];
        for (const tok of item.tokens) {
          if (tok.type === 'list') nested.push(tok as Tokens.List);
          else if (tok.type === 'text' || tok.type === 'paragraph') children.push(...this.inline((tok as Tokens.Text).tokens ?? [tok], style));
        }
        paras.push(
          new Paragraph({
            children,
            spacing: { after: 40 },
            ...(list.ordered
              ? { numbering: { reference: 'sop-numbered', level: Math.min(level, 2), instance } }
              : { bullet: { level: Math.min(level, 2) } }),
          }),
        );
        for (const n of nested) walkList(n, level + 1);
      }
    };
    for (const tok of mdLexer(text)) {
      if (tok.type === 'space' || tok.type === 'hr') continue;
      if (tok.type === 'list') walkList(tok as Tokens.List, 0);
      else if (tok.type === 'heading') {
        paras.push(new Paragraph({ children: this.inline((tok as Tokens.Heading).tokens, { ...style, bold: true }), spacing: { before: 80, after: 60 } }));
      } else if (tok.type === 'code') {
        paras.push(new Paragraph({ children: [new TextRun({ text: (tok as Tokens.Code).text, font: 'Consolas' })] }));
      } else if (tok.type === 'blockquote') {
        paras.push(new Paragraph({ children: this.inline((tok as Tokens.Blockquote).tokens.flatMap((x) => ('tokens' in x ? (x.tokens as Token[]) : [])), { ...style, italics: true }), indent: { left: 360 } }));
      } else {
        const tokens = 'tokens' in tok && tok.tokens ? (tok.tokens as Token[]) : [tok];
        paras.push(new Paragraph({ children: this.inline(tokens, style), spacing: { after: 100 } }));
      }
    }
    return paras;
  }

  // -------------------------------------------------------------------------
  // Images
  // -------------------------------------------------------------------------

  async image(mediaId: string, maxWidthPx: number, maxHeightPx: number): Promise<Img | null> {
    const m = findMedia(mediaId);
    if (!m) return null;
    try {
      const v = await ensureVariant(mediaId, 'docx');
      const data = await fs.readFile(v.file);
      const meta = await sharp(data).metadata();
      return fit({ data, type: v.contentType === 'image/png' ? 'png' : 'jpg', width: meta.width ?? 800, height: meta.height ?? 600 }, maxWidthPx, maxHeightPx);
    } catch (err) {
      console.warn('docx image failed', mediaId, err);
      return null;
    }
  }

  imageRun(img: Img) {
    return new ImageRun({ type: img.type, data: img.data, transformation: { width: img.width, height: img.height } });
  }

  async logo(maxW: number, maxH: number): Promise<Img | null> {
    const id = this.ctx.settings.branding.logoMediaId;
    return id ? this.image(id, maxW, maxH) : null;
  }

  async figure(item: StepMedia, maxW: number, maxH: number): Promise<(Paragraph | Table)[]> {
    const m = this.ctx.media.get(item.mediaId);
    if (!m) return [];
    const caption = item.caption
      ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: item.caption, size: this.size - 4, color: this.muted, italics: true })] })]
      : [];
    if (m.kind === 'image') {
      const img = await this.image(m.id, maxW, maxH);
      if (!img) return [];
      return [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 40 }, children: [this.imageRun(img)] }), ...caption];
    }
    return [...(await this.videoBlock(m, maxW, maxH)), ...caption];
  }

  async videoBlock(m: MediaItem, maxW: number, maxH: number): Promise<(Paragraph | Table)[]> {
    const handling = this.ctx.settings.export.videoHandling;
    if (handling === 'omit') return [];
    const poster = await this.image(m.id, maxW, Math.min(maxH, 260));
    const out: (Paragraph | Table)[] = [];
    if (poster) out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [this.imageRun(poster)] }));
    const dur = formatDuration(m.duration);
    if (handling === 'qr') {
      const qrPng = await (await import('qrcode')).default.toBuffer(videoUrl(this.ctx.sop.id, m.id), { margin: 1, width: 200 });
      out.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({ type: 'png', data: qrPng, transformation: { width: 72, height: 72 } }),
            new TextRun({ text: `  Scan to watch the video${dur ? ` (${dur})` : ''}`, bold: true, size: this.size - 2 }),
          ],
        }),
      );
    } else {
      out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Video${dur ? ` (${dur})` : ''}: open the digital SOP to watch.`, italics: true, color: this.muted })] }));
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Blocks
  // -------------------------------------------------------------------------

  sectionHeading(label: string): Paragraph {
    const d = this.ctx.design;
    const band = d.style.headingStyle === 'band';
    const text = d.style.uppercaseHeadings ? label.toUpperCase() : label;
    return new Paragraph({
      heading: HeadingLevel.HEADING_1,
      keepNext: true,
      spacing: { before: 280, after: 140 },
      shading: band ? { type: ShadingType.CLEAR, fill: this.primary, color: 'auto' } : undefined,
      border:
        d.style.headingStyle === 'underline'
          ? { bottom: { style: BorderStyle.SINGLE, size: 12, color: this.accent, space: 2 } }
          : d.style.headingStyle === 'leftbar'
            ? { left: { style: BorderStyle.SINGLE, size: 36, color: this.accent, space: 6 } }
            : undefined,
      children: [new TextRun({ text, color: band ? 'FFFFFF' : this.primary, bold: true })],
    });
  }

  callout(type: CalloutType, text: string): Table | null {
    if (type === 'none' || !text.trim()) return null;
    const meta = CALLOUT_META[type];
    const color = hex(meta.color);
    const filled = this.ctx.design.style.calloutStyle === 'filled';
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      borders: filled
        ? { top: NO_BORDER, bottom: NO_BORDER, right: NO_BORDER, left: { style: BorderStyle.SINGLE, size: 36, color }, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER }
        : { top: thin(color), bottom: thin(color), left: thin(color), right: thin(color), insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              shading: filled ? { type: ShadingType.CLEAR, fill: hex(meta.bg), color: 'auto' } : undefined,
              margins: { top: 80, bottom: 80, left: 160, right: 160 },
              children: [
                new Paragraph({ children: [new TextRun({ text: `${type === 'note' || type === 'tip' ? '' : '⚠ '}${meta.label}`, bold: true, color, size: this.size - 3 })] }),
                ...this.markdown(text),
              ],
            }),
          ],
        }),
      ],
    });
  }

  infoTable(rows: [string, string][], cols: 2 | 4 = 4): Table {
    const pairs: [string, string][][] = [];
    for (let i = 0; i < rows.length; i += cols / 2) pairs.push(rows.slice(i, i + cols / 2));
    const line = hex(this.ctx.design.colors.primary);
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: thin(line), bottom: thin(line), left: thin(line), right: thin(line), insideHorizontal: thin('D1D5DB'), insideVertical: thin('D1D5DB') },
      rows: pairs.map(
        (pair) =>
          new TableRow({
            children: pair.flatMap(([k, v]) => [
              new TableCell({
                width: { size: cols === 4 ? 18 : 32, type: WidthType.PERCENTAGE },
                shading: { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' },
                margins: { top: 60, bottom: 60, left: 100, right: 100 },
                children: [new Paragraph({ children: [new TextRun({ text: k, bold: true, color: this.primary, size: this.size - 2 })] })],
              }),
              new TableCell({
                width: { size: cols === 4 ? 32 : 68, type: WidthType.PERCENTAGE },
                margins: { top: 60, bottom: 60, left: 100, right: 100 },
                children: [new Paragraph({ children: [new TextRun({ text: v, size: this.size - 2 })] })],
              }),
            ]),
          }),
      ),
    });
  }

  dataTable(head: string[], rows: string[][], widths: number[], rowHeight?: number): Table {
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: thin(), bottom: thin(), left: thin(), right: thin(), insideHorizontal: thin('E5E7EB'), insideVertical: thin('E5E7EB') },
      rows: [
        new TableRow({
          tableHeader: true,
          children: head.map(
            (h, i) =>
              new TableCell({
                width: { size: widths[i], type: WidthType.PERCENTAGE },
                shading: { type: ShadingType.CLEAR, fill: this.primary, color: 'auto' },
                margins: { top: 60, bottom: 60, left: 100, right: 100 },
                children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: 'FFFFFF', size: this.size - 2 })] })],
              }),
          ),
        }),
        ...rows.map(
          (r) =>
            new TableRow({
              height: rowHeight ? { value: rowHeight, rule: 'atLeast' } : undefined,
              children: r.map(
                (c, i) =>
                  new TableCell({
                    width: { size: widths[i], type: WidthType.PERCENTAGE },
                    margins: { top: 60, bottom: 60, left: 100, right: 100 },
                    verticalAlign: VerticalAlign.CENTER,
                    children: [new Paragraph({ children: [new TextRun({ text: c, size: this.size - 2 })] })],
                  }),
              ),
            }),
        ),
      ],
    });
  }

  listBox(items: string[], fill: string | null, marker: string): (Paragraph | Table)[] {
    const paras = items.map(
      (x) =>
        new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: `${marker}  `, color: this.accent, bold: true }), ...this.inline(mdLexer(x).flatMap((t) => ('tokens' in t ? (t.tokens as Token[]) : [])))],
        }),
    );
    if (!fill) return paras;
    return [
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: thin(this.accent), bottom: thin(this.accent), left: thin(this.accent), right: thin(this.accent), insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
        rows: [new TableRow({ children: [new TableCell({ shading: { type: ShadingType.CLEAR, fill, color: 'auto' }, margins: { top: 100, bottom: 100, left: 160, right: 160 }, children: paras })] })],
      }),
    ];
  }

  async steps(): Promise<(Paragraph | Table)[]> {
    const d = this.ctx.design;
    const out: (Paragraph | Table)[] = [];
    let n = 0;
    const side = d.steps.layout === 'side-by-side';
    const colPct = { small: 34, medium: 44, large: 54 }[d.steps.imageSize];
    const maxH = { small: 230, medium: 320, large: 440 }[d.steps.imageSize];
    for (const step of this.ctx.sop.content.steps) {
      if (step.kind === 'section') {
        out.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            keepNext: true,
            spacing: { before: 240, after: 100 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB', space: 2 } },
            children: [new TextRun({ text: step.title || 'Section', color: this.primary, bold: true })],
          }),
        );
        continue;
      }
      n += 1;
      const badge = hex(d.colors.stepBadge);
      const label = d.style.stepStyle === 'label' ? ` STEP ${n} ` : ` ${n} `;
      out.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          keepNext: true,
          spacing: { before: 200, after: 80 },
          children: [
            new TextRun({ text: label, bold: true, color: hex(d.colors.stepBadgeText), shading: { type: ShadingType.CLEAR, fill: badge, color: 'auto' } }),
            new TextRun({ text: `  ${step.title || `Step ${n}`}`, bold: true, color: this.text }),
          ],
        }),
      );
      const textBlocks: (Paragraph | Table)[] = [...this.markdown(step.body)];
      const callout = this.callout(step.callout.type, step.callout.text);
      if (callout) textBlocks.push(callout, new Paragraph({ children: [], spacing: { after: 60 } }));

      if (!step.media.length) {
        out.push(...textBlocks);
        continue;
      }
      if (side) {
        const mediaW = Math.round((this.contentWidthPx * colPct) / 100) - 16;
        const figures: (Paragraph | Table)[] = [];
        for (const m of step.media) figures.push(...(await this.figure(m, mediaW, maxH)));
        const textCell = new TableCell({ width: { size: 100 - colPct, type: WidthType.PERCENTAGE }, margins: { right: 200 }, children: textBlocks.length ? textBlocks : [new Paragraph('')] });
        const mediaCell = new TableCell({ width: { size: colPct, type: WidthType.PERCENTAGE }, children: figures.length ? figures : [new Paragraph('')] });
        out.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
            borders: NO_BORDERS,
            rows: [new TableRow({ cantSplit: d.steps.keepTogether, children: d.steps.imagePosition === 'left' ? [mediaCell, textCell] : [textCell, mediaCell] })],
          }),
        );
      } else {
        out.push(...textBlocks);
        const w = Math.round(this.contentWidthPx * ({ small: 0.55, medium: 0.78, large: 1 }[d.steps.imageSize]));
        for (const m of step.media) out.push(...(await this.figure(m, w, maxH + 80)));
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Document
  // -------------------------------------------------------------------------

  tokens(): Record<string, string> {
    const s = this.ctx.sop;
    return {
      company: this.ctx.settings.branding.companyName,
      title: s.title,
      number: s.number,
      version: s.version,
      status: STATUS_LABELS[s.status] ?? s.status,
      category: this.ctx.category?.name ?? '',
      effectiveDate: formatDate(s.effectiveDate) || 'Pending approval',
      printedDate: this.ctx.printedDate,
    };
  }

  async build(): Promise<Buffer> {
    const ctx = this.ctx;
    const d = ctx.design;
    const s = ctx.sop;
    const c = s.content;
    const geo = pageGeometry(d);
    const t = this.tokens();
    const inch = (n: number) => convertInchesToTwip(n);
    const portraitW = Math.min(geo.width, geo.height);
    const portraitH = Math.max(geo.width, geo.height);
    const page = {
      size: { width: inch(portraitW), height: inch(portraitH), orientation: d.page.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
      margin: { top: inch(geo.margins.top), bottom: inch(geo.margins.bottom), left: inch(geo.margins.side), right: inch(geo.margins.side), header: inch(0.35), footer: inch(0.35) },
    };
    const rightTab = [{ type: TabStopType.RIGHT, position: inch(geo.width - geo.margins.side * 2) }];

    // Header & footer
    const logo = d.header.enabled && d.header.showLogo ? await this.logo(140, 32) : null;
    const header = d.header.enabled
      ? new Header({
          children: [
            new Paragraph({
              tabStops: rightTab,
              border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: this.primary, space: 4 } },
              children: [
                ...(logo ? [this.imageRun(logo), new TextRun({ text: '   ' })] : []),
                new TextRun({ text: fillTokens(d.header.left, t), bold: true, size: 16, color: this.text }),
                new TextRun({ text: `\t${fillTokens(d.header.right, t)}`, size: 16, color: this.muted }),
              ],
            }),
          ],
        })
      : undefined;
    const footer = d.footer.enabled
      ? new Footer({
          children: [
            new Paragraph({
              tabStops: rightTab,
              children: [
                new TextRun({ text: fillTokens(d.footer.left, t), size: 14, color: this.muted }),
                new TextRun({ text: d.footer.center ? `   ${fillTokens(d.footer.center, t)}` : '', size: 14, color: this.muted, bold: true }),
                ...(d.footer.showPageNumbers
                  ? [new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 14, color: this.muted })]
                  : []),
              ],
            }),
          ],
        })
      : undefined;

    // Body
    const body: (Paragraph | Table | TableOfContents)[] = [];
    const sections = d.sections.filter((x) => x.enabled);
    for (const sec of sections) {
      const k = sec.key;
      const empty =
        (k === 'purpose' && !c.purpose.trim()) ||
        (k === 'scope' && !c.scope.trim()) ||
        (k === 'responsibilities' && !c.responsibilities.trim()) ||
        (k === 'notes' && !c.notes.trim()) ||
        (k === 'safety' && !c.safety.length) ||
        (k === 'tools' && !c.tools.length) ||
        (k === 'attachments' && !c.attachments.some((a) => ctx.media.has(a.mediaId)));
      if (empty) continue;
      if (k === 'toc') {
        body.push(this.sectionHeading(sec.label));
        body.push(new TableOfContents(sec.label, { hyperlink: true, headingStyleRange: '1-3' }));
        continue;
      }
      body.push(this.sectionHeading(sec.label));
      switch (k) {
        case 'docInfo':
          body.push(
            this.infoTable([
              ['Document No.', s.number],
              ['Version', s.version],
              ['Status', STATUS_LABELS[s.status] ?? s.status],
              ['Category', ctx.category?.name ?? '—'],
              ['Effective date', formatDate(s.effectiveDate) || 'On approval'],
              ['Next review', formatDate(s.reviewDate) || '—'],
              ['Owner', s.owner || '—'],
              ['Approver', s.approver || '—'],
            ]),
          );
          break;
        case 'purpose':
        case 'scope':
        case 'responsibilities':
        case 'notes':
          body.push(...this.markdown(c[k]));
          break;
        case 'safety':
          body.push(...this.listBox(c.safety, hex('#FFFBEB'), '▲'));
          break;
        case 'tools':
          body.push(...this.listBox(c.tools, null, '■'));
          break;
        case 'procedure':
          body.push(...(await this.steps()));
          break;
        case 'attachments':
          for (const a of c.attachments) body.push(...(await this.figure(a, Math.round(this.contentWidthPx * 0.7), 360)));
          break;
        case 'revisions':
          body.push(
            this.dataTable(
              ['Version', 'Date', 'Description of change', 'Approved by'],
              ctx.revisions.length
                ? ctx.revisions.map((r) => [r.version, formatDate(r.createdAt), r.summary, r.createdByName ?? ''])
                : [[s.version, '—', 'Initial release (pending approval)', '']],
              [12, 18, 48, 22],
            ),
          );
          break;
        case 'approvals':
          body.push(
            this.dataTable(
              ['Role', 'Name', 'Signature', 'Date'],
              [
                ['Prepared by', s.owner],
                ['Reviewed by', ''],
                ['Approved by', s.approver],
              ],
              [20, 30, 32, 18],
              560,
            ),
          );
          break;
      }
    }

    const docSections: ISectionOptions[] = [];
    if (d.cover.enabled) docSections.push({ properties: { page, titlePage: false }, children: await this.cover() });
    docSections.push({ properties: { page }, headers: header ? { default: header } : undefined, footers: footer ? { default: footer } : undefined, children: body });

    const doc = new Document({
      creator: ctx.settings.branding.companyName,
      title: `${s.number} ${s.title}`,
      description: `Standard Operating Procedure ${s.number} revision ${s.version}`,
      features: { updateFields: sections.some((x) => x.key === 'toc') },
      styles: {
        default: { document: { run: { font: this.font, size: this.size, color: this.text } } },
        paragraphStyles: [
          { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: Math.round(this.size * 1.4), bold: true, color: this.primary } },
          { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: Math.round(this.size * 1.15), bold: true, color: this.primary } },
          { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: Math.round(this.size * 1.1), bold: true, color: this.text } },
        ],
      },
      numbering: {
        config: [
          {
            reference: 'sop-numbered',
            levels: [0, 1, 2].map((level) => ({
              level,
              format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level],
              text: `%${level + 1}.`,
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } } },
            })),
          },
        ],
      },
      sections: docSections,
    });
    return Packer.toBuffer(doc);
  }

  async cover(): Promise<(Paragraph | Table)[]> {
    const ctx = this.ctx;
    const d = ctx.design;
    const s = ctx.sop;
    const out: (Paragraph | Table)[] = [];
    const logo = await this.logo(260, 90);
    if (logo) out.push(new Paragraph({ alignment: d.cover.style === 'centered' ? AlignmentType.CENTER : AlignmentType.LEFT, children: [this.imageRun(logo)], spacing: { after: 200 } }));
    const align = d.cover.style === 'centered' ? AlignmentType.CENTER : AlignmentType.LEFT;
    out.push(
      new Paragraph({ alignment: align, children: [new TextRun({ text: ctx.settings.branding.companyName, bold: true, size: 28, color: this.primary })] }),
      new Paragraph({ alignment: align, spacing: { before: 1600 }, children: [new TextRun({ text: d.cover.subtitle.toUpperCase(), bold: true, size: 20, color: this.accent, characterSpacing: 40 })] }),
      new Paragraph({ alignment: align, spacing: { before: 120, after: 120 }, children: [new TextRun({ text: s.title, bold: true, size: 60, color: this.text })] }),
      new Paragraph({
        alignment: align,
        border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: this.accent, space: 6 } },
        children: [new TextRun({ text: s.number, bold: true, size: 28, color: this.primary }), ...(ctx.category ? [new TextRun({ text: `   ·   ${ctx.category.name}`, size: 24, color: this.muted })] : [])],
      }),
      new Paragraph({ spacing: { before: 1400 }, children: [] }),
      this.infoTable(
        [
          ['Version', s.version],
          ['Status', STATUS_LABELS[s.status] ?? s.status],
          ['Effective date', formatDate(s.effectiveDate) || 'On approval'],
          ['Next review', formatDate(s.reviewDate) || '—'],
          ['Owner', s.owner || '—'],
          ['Approver', s.approver || '—'],
        ],
        2,
      ),
    );
    if (d.cover.showQr) {
      const qr = await (await import('qrcode')).default.toBuffer(ctx.sopUrl, { margin: 1, width: 240 });
      out.push(
        new Paragraph({
          spacing: { before: 400 },
          children: [
            new ImageRun({ type: 'png', data: qr, transformation: { width: 90, height: 90 } }),
            new TextRun({ text: '   Scan for the latest version  ', bold: true, size: 18 }),
            new TextRun({ text: ctx.sopUrl.replace(/^https?:\/\//, ''), size: 16, color: this.muted }),
          ],
        }),
      );
    }
    out.push(new Paragraph({ children: [new PageBreak()] }));
    return out;
  }
}

function fit(img: Img, maxW: number, maxH: number): Img {
  const scale = Math.min(1, maxW / img.width, maxH / img.height);
  return { ...img, width: Math.max(1, Math.round(img.width * scale)), height: Math.max(1, Math.round(img.height * scale)) };
}

function decodeEntities(s: string) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export async function renderDocx(ctx: RenderContext): Promise<Buffer> {
  return new WordBuilder(ctx).build();
}
