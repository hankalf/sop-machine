import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import sharp from 'sharp';

export interface ExtractedImage {
  /** Full-resolution image to store with the SOP. */
  data: Buffer;
  mime: 'image/png' | 'image/jpeg';
  /** Smaller JPEG for the AI. */
  preview: Buffer;
  width: number;
  height: number;
  label: string;
}

export interface ExtractedDocument {
  kind: 'pdf' | 'docx' | 'text';
  text: string;
  pdf: Buffer | null;
  images: ExtractedImage[];
}

const MAX_IMAGES = 40;
const MIN_SIDE = 120;

export function documentKind(fileName: string, mime: string): ExtractedDocument['kind'] | null {
  const name = fileName.toLowerCase();
  if (name.endsWith('.pdf') || mime === 'application/pdf') return 'pdf';
  if (name.endsWith('.docx') || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (name.endsWith('.txt') || name.endsWith('.md') || mime.startsWith('text/')) return 'text';
  return null;
}

/** Normalize, filter (tiny icons, logos repeated on many pages, unreadable formats) and dedupe images. */
async function prepareImages(raw: { data: Buffer; label: string }[]): Promise<{ kept: ExtractedImage[]; keptFrom: number[] }> {
  // Pass 1: decode and fingerprint everything.
  const decoded: ({ fingerprint: string; width: number; height: number; png: boolean } | null)[] = [];
  const occurrences = new Map<string, number>();
  for (const r of raw) {
    try {
      const meta = await sharp(r.data, { failOn: 'none' }).metadata();
      const small = await sharp(r.data, { failOn: 'none' }).resize(16, 16, { fit: 'fill' }).greyscale().raw().toBuffer();
      const fingerprint = crypto.createHash('sha1').update(small).digest('hex');
      occurrences.set(fingerprint, (occurrences.get(fingerprint) ?? 0) + 1);
      const rotated = (meta.orientation ?? 1) >= 5;
      decoded.push({
        fingerprint,
        width: (rotated ? meta.height : meta.width) ?? 0,
        height: (rotated ? meta.width : meta.height) ?? 0,
        png: meta.format === 'png' || meta.format === 'gif',
      });
    } catch {
      decoded.push(null); // EMF/WMF and other formats browsers can't show
    }
  }
  // Pass 2: keep real content images, once each.
  const kept: ExtractedImage[] = [];
  const keptFrom: number[] = [];
  const used = new Set<string>();
  for (let i = 0; i < raw.length && kept.length < MAX_IMAGES; i++) {
    const d = decoded[i];
    if (!d || d.width < MIN_SIDE || d.height < MIN_SIDE * 0.6) continue;
    if ((occurrences.get(d.fingerprint) ?? 0) >= 3 || used.has(d.fingerprint)) continue; // logo / header graphic / duplicate
    used.add(d.fingerprint);
    const img = sharp(raw[i].data, { failOn: 'none' }).rotate();
    const data = d.png ? await img.png().toBuffer() : await img.flatten({ background: '#fff' }).jpeg({ quality: 90 }).toBuffer();
    const preview = await sharp(data)
      .resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#fff' })
      .jpeg({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    kept.push({ data, mime: d.png ? 'image/png' : 'image/jpeg', preview: preview.data, width: preview.info.width, height: preview.info.height, label: raw[i].label });
    keptFrom.push(i);
  }
  return { kept, keptFrom };
}

function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|h[1-6]|div|tr|table|ul|ol)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<h([1-6])[^>]*>/gi, (_m, n: string) => `\n${'#'.repeat(Number(n))} `)
    .replace(/<(strong|b)>/gi, '**')
    .replace(/<\/(strong|b)>/gi, '**')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractDocx(file: string): Promise<ExtractedDocument> {
  const raw: { data: Buffer; label: string }[] = [];
  const result = await mammoth.convertToHtml(
    { path: file },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const index = raw.length;
        raw.push({ data: Buffer.from(await image.readAsBuffer()), label: `image ${index + 1} in the document` });
        return { src: `sop-image-${index}` };
      }),
    },
  );
  const { kept, keptFrom } = await prepareImages(raw);
  const newIndex = new Map(keptFrom.map((orig, i) => [orig, i]));
  const html = result.value.replace(/<img[^>]*src="sop-image-(\d+)"[^>]*>/g, (_m, n: string) => {
    const i = newIndex.get(Number(n));
    return i === undefined ? '' : `\n[[IMAGE ${i}]]\n`;
  });
  return { kind: 'docx', text: htmlToText(html), pdf: null, images: kept.map((k, i) => ({ ...k, label: `[[IMAGE ${i}]]` })) };
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-400) || `${cmd} failed`))));
  });
}

async function extractPdf(file: string, workDir: string): Promise<ExtractedDocument> {
  const pdf = await fsp.readFile(file);
  const raw: { data: Buffer; label: string }[] = [];
  try {
    const prefix = path.join(workDir, 'img');
    await run('pdfimages', ['-png', '-p', file, prefix]);
    const files = (await fsp.readdir(workDir)).filter((f) => f.startsWith('img-') && f.endsWith('.png')).sort();
    for (const f of files) {
      const page = /img-(\d+)-/.exec(f)?.[1];
      raw.push({ data: await fsp.readFile(path.join(workDir, f)), label: `page ${Number(page)}` });
    }
  } catch (err) {
    console.warn('pdfimages unavailable or failed; importing text only', (err as Error).message);
  }
  const { kept } = await prepareImages(raw);
  return { kind: 'pdf', text: '', pdf, images: kept };
}

export async function extractDocument(file: string, fileName: string, mime: string, workDir: string): Promise<ExtractedDocument> {
  const kind = documentKind(fileName, mime);
  if (kind === 'pdf') return extractPdf(file, workDir);
  if (kind === 'docx') return extractDocx(file);
  if (kind === 'text') return { kind: 'text', text: await fsp.readFile(file, 'utf8'), pdf: null, images: [] };
  throw new Error(`${fileName}: unsupported file. Use PDF, Word (.docx) or text. For old .doc files, save as .docx first.`);
}
