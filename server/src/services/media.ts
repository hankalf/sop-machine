import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { MediaItem } from '../../../shared/types';
import { config } from '../config';
import { db } from '../db';
import { badRequest, newId, notFound, nowIso } from '../util';
import { BROWSER_SAFE_CODECS, extractFrame, probe, transcodeToMp4 } from './ffmpeg';
import { deleteOriginal, localOriginal, objectStorageEnabled, saveOriginal, type StorageLocation } from './storage';

interface MediaRow {
  id: string;
  kind: 'image' | 'video';
  mime: string;
  ext: string;
  original_name: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  parent_id: string | null;
  processing: number;
  storage: StorageLocation;
  created_by: string | null;
  created_at: string;
}

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

const VIDEO_TYPES: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
  'video/x-msvideo': 'avi',
  'video/x-matroska': 'mkv',
  'video/x-ms-wmv': 'wmv',
  'video/mpeg': 'mpeg',
};

const EXT_TO_MIME: Record<string, string> = Object.fromEntries(
  [...Object.entries(IMAGE_TYPES), ...Object.entries(VIDEO_TYPES)].map(([m, e]) => [e, m]),
);
EXT_TO_MIME.jpeg = 'image/jpeg';
EXT_TO_MIME.tif = 'image/tiff';

export type Variant = 'thumb' | 'display' | 'display-hq' | 'poster' | 'docx';

const toItem = (r: MediaRow): MediaItem => ({
  id: r.id,
  kind: r.kind,
  mime: r.mime,
  originalName: r.original_name,
  size: r.size,
  width: r.width,
  height: r.height,
  duration: r.duration,
  parentId: r.parent_id,
  processing: !!r.processing,
  createdAt: r.created_at,
});

function row(id: string): MediaRow {
  const r = db.prepare('SELECT * FROM media WHERE id = ?').get(id) as MediaRow | undefined;
  if (!r) throw notFound('Media not found');
  return r;
}

export function getMedia(id: string): MediaItem {
  return toItem(row(id));
}

export function findMedia(id: string): MediaItem | null {
  const r = db.prepare('SELECT * FROM media WHERE id = ?').get(id) as MediaRow | undefined;
  return r ? toItem(r) : null;
}

export function mediaMap(ids: Iterable<string>): Map<string, MediaItem> {
  const map = new Map<string, MediaItem>();
  for (const id of new Set(ids)) {
    const m = findMedia(id);
    if (m) map.set(id, m);
  }
  return map;
}

const fileName = (r: MediaRow) => `${r.id}.${r.ext}`;

/** Where the original is stored, for streaming it to the browser. */
export function originalInfo(id: string): { file: string; location: StorageLocation; mime: string } {
  const r = row(id);
  return { file: fileName(r), location: r.storage, mime: r.mime };
}

/** A path on local disk to the original (downloads it from object storage if needed). */
export async function originalLocalPath(id: string): Promise<string> {
  const r = row(id);
  return localOriginal(fileName(r), r.storage);
}

async function moveToFinalStorage(id: string) {
  const r = row(id);
  if (r.storage !== 'local' || !objectStorageEnabled) return;
  const location = await saveOriginal(fileName(r), path.join(config.uploadsDir, fileName(r)), r.mime);
  db.prepare('UPDATE media SET storage = ? WHERE id = ?').run(location, id);
}

const derivedDir = (id: string) => path.join(config.derivedDir, id);

function classify(mime: string, originalName: string): { kind: 'image' | 'video'; mime: string; ext: string } {
  let m = mime.toLowerCase();
  const ext = path.extname(originalName).slice(1).toLowerCase();
  if ((!IMAGE_TYPES[m] && !VIDEO_TYPES[m]) || m === 'application/octet-stream') m = EXT_TO_MIME[ext] ?? m;
  if (IMAGE_TYPES[m]) return { kind: 'image', mime: m, ext: IMAGE_TYPES[m] };
  if (VIDEO_TYPES[m]) return { kind: 'video', mime: m, ext: VIDEO_TYPES[m] };
  if (ext === 'heic' || ext === 'heif' || m.includes('heic')) {
    throw badRequest('HEIC photos are not supported yet. On iPhone set Camera > Formats to "Most Compatible", or export as JPG.');
  }
  throw badRequest(`Unsupported file type: ${originalName}. Upload an image (JPG, PNG, GIF, WebP) or a video (MP4, MOV, WebM).`);
}

/** Move an uploaded temp file into storage and record it. */
export async function storeFile(
  tempPath: string,
  originalName: string,
  mime: string,
  userId: string | null,
  parentId: string | null = null,
): Promise<MediaItem> {
  const { kind, mime: finalMime, ext } = classify(mime, originalName);
  const id = newId();
  const dest = path.join(config.uploadsDir, `${id}.${ext}`);
  await moveFile(tempPath, dest);
  const size = (await fsp.stat(dest)).size;

  let width: number | null = null;
  let height: number | null = null;
  let duration: number | null = null;
  let processing = false;

  try {
    if (kind === 'image') {
      const meta = await sharp(dest).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
      if (meta.orientation && meta.orientation >= 5) [width, height] = [height, width];
    } else {
      const p = await probe(dest);
      width = p.width;
      height = p.height;
      duration = p.duration;
      const container = p.formatName.split(',');
      const playable =
        p.videoCodec !== null &&
        BROWSER_SAFE_CODECS.has(p.videoCodec) &&
        (container.includes('mp4') || container.includes('webm') || container.includes('mov')) &&
        Math.max(p.width ?? 0, p.height ?? 0) <= 2160;
      processing = !playable;
    }
  } catch (err) {
    await fsp.rm(dest, { force: true });
    throw badRequest(`Could not read ${originalName}: ${(err as Error).message.slice(0, 200)}`);
  }

  db.prepare(
    `INSERT INTO media (id, kind, mime, ext, original_name, size, width, height, duration, parent_id, processing, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, kind, finalMime, ext, originalName, size, width, height, duration, parentId, processing ? 1 : 0, userId, nowIso());

  if (kind === 'video') await ensureVariant(id, 'poster').catch((e) => console.warn('poster failed', id, e));
  if (kind === 'video' && processing) enqueueTranscode(id);
  else await moveToFinalStorage(id).catch((e) => console.error('could not move upload to object storage', id, e));
  return getMedia(id);
}

export async function storeBuffer(
  buffer: Buffer,
  originalName: string,
  mime: string,
  userId: string | null,
  parentId: string | null = null,
): Promise<MediaItem> {
  const tmp = path.join(config.tmpDir, `${newId()}-${path.basename(originalName)}`);
  await fsp.writeFile(tmp, buffer);
  return storeFile(tmp, originalName, mime, userId, parentId);
}

async function moveFile(from: string, to: string) {
  try {
    await fsp.rename(from, to);
  } catch {
    await fsp.copyFile(from, to);
    await fsp.rm(from, { force: true });
  }
}

// ---------------------------------------------------------------------------
// Derived variants (generated lazily, cached on disk)
// ---------------------------------------------------------------------------

const inflight = new Map<string, Promise<string>>();

export function variantPath(id: string, variant: Variant): { file: string; contentType: string } {
  const r = row(id);
  const dir = derivedDir(id);
  switch (variant) {
    case 'thumb':
      return { file: path.join(dir, 'thumb.webp'), contentType: 'image/webp' };
    case 'poster':
      return { file: path.join(dir, 'poster.jpg'), contentType: 'image/jpeg' };
    case 'docx':
      return r.ext === 'png' || r.kind === 'video'
        ? { file: path.join(dir, 'docx.png'), contentType: 'image/png' }
        : { file: path.join(dir, 'docx.jpg'), contentType: 'image/jpeg' };
    case 'display':
    case 'display-hq': {
      const png = r.kind === 'image' && (r.ext === 'png' || r.ext === 'gif' || r.ext === 'bmp');
      return {
        file: path.join(dir, `${variant}.${png ? 'png' : 'jpg'}`),
        contentType: png ? 'image/png' : 'image/jpeg',
      };
    }
  }
}

export async function ensureVariant(id: string, variant: Variant): Promise<{ file: string; contentType: string }> {
  const target = variantPath(id, variant);
  if (fs.existsSync(target.file)) return target;
  const key = `${id}:${variant}`;
  let p = inflight.get(key);
  if (!p) {
    p = buildVariant(id, variant, target.file).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  await p;
  return target;
}

async function buildVariant(id: string, variant: Variant, out: string): Promise<string> {
  const r = row(id);
  await fsp.mkdir(derivedDir(id), { recursive: true });
  const tmp = `${out}.${process.pid}.tmp`;
  const original = () => localOriginal(fileName(r), r.storage);

  if (variant === 'poster') {
    if (r.kind !== 'video') throw badRequest('Only videos have posters');
    const at = Math.min(1, (r.duration ?? 0) / 2);
    await extractFrame(await original(), at, tmp.replace(/\.tmp$/, '.jpg'), 1600);
    await fsp.rename(tmp.replace(/\.tmp$/, '.jpg'), out);
    return out;
  }

  // Images are generated from the original (or from the poster for videos).
  const source = r.kind === 'video' ? (await ensureVariant(id, 'poster')).file : await original();
  let img = sharp(source, { animated: false }).rotate();
  if (variant === 'thumb') {
    img = img.resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 });
  } else {
    const max = variant === 'display-hq' ? 2600 : variant === 'docx' ? 1600 : 1800;
    img = img.resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true });
    img = out.endsWith('.png') ? img.png({ compressionLevel: 9, palette: false }) : img.flatten({ background: '#ffffff' }).jpeg({ quality: 85, mozjpeg: true });
  }
  await img.toFile(tmp);
  await fsp.rename(tmp, out);
  return out;
}

// ---------------------------------------------------------------------------
// Background video transcoding (phone .mov/HEVC, .avi, etc.)
// ---------------------------------------------------------------------------

let queue: Promise<void> = Promise.resolve();

function enqueueTranscode(id: string) {
  queue = queue.then(() => transcode(id)).catch((e) => console.error('transcode failed', id, e));
}

async function transcode(id: string) {
  const r = row(id);
  const src = await localOriginal(fileName(r), r.storage);
  const out = path.join(config.tmpDir, `${id}.mp4`);
  try {
    await transcodeToMp4(src, out);
    const dest = path.join(config.uploadsDir, `${id}.mp4`);
    await moveFile(out, dest);
    if (dest !== src) await deleteOriginal(fileName(r), r.storage);
    const p = await probe(dest);
    const size = (await fsp.stat(dest)).size;
    db.prepare(
      "UPDATE media SET ext = 'mp4', mime = 'video/mp4', size = ?, width = ?, height = ?, duration = ?, processing = 0, storage = 'local' WHERE id = ?",
    ).run(size, p.width, p.height, p.duration, id);
  } catch (err) {
    console.error(`Could not convert video ${id}; keeping the original`, err);
    db.prepare('UPDATE media SET processing = 0 WHERE id = ?').run(id);
  }
  await moveToFinalStorage(id).catch((e) => console.error('could not move video to object storage', id, e));
}

/** Restart video conversions that were interrupted by a server restart. */
export function resumeProcessing() {
  const pending = db.prepare('SELECT id FROM media WHERE processing = 1').all() as { id: string }[];
  for (const p of pending) enqueueTranscode(p.id);
}

export async function deleteMediaFiles(id: string) {
  const r = db.prepare('SELECT * FROM media WHERE id = ?').get(id) as MediaRow | undefined;
  if (!r) return;
  await deleteOriginal(fileName(r), r.storage);
  await fsp.rm(derivedDir(id), { recursive: true, force: true });
  db.prepare('DELETE FROM media WHERE id = ?').run(id);
}

export const ACCEPTED_UPLOADS = [...Object.keys(IMAGE_TYPES), ...Object.keys(VIDEO_TYPES)];

/** Upload every original still on the volume to the bucket (Admin → Storage). */
export async function migrateToObjectStorage(onProgress: (done: number, total: number) => void): Promise<{ moved: number; failed: number }> {
  if (!objectStorageEnabled) throw badRequest('Object storage is not configured');
  const rows = db.prepare("SELECT * FROM media WHERE storage = 'local' AND processing = 0").all() as MediaRow[];
  let moved = 0;
  let failed = 0;
  for (const [i, r] of rows.entries()) {
    try {
      if (fs.existsSync(path.join(config.uploadsDir, fileName(r)))) {
        await moveToFinalStorage(r.id);
        moved++;
      }
    } catch (err) {
      failed++;
      console.error('migration failed for', r.id, err);
    }
    onProgress(i + 1, rows.length);
  }
  return { moved, failed };
}

export function storageCounts(): { local: number; object: number } {
  const rows = db.prepare('SELECT storage, COUNT(*) AS n FROM media GROUP BY storage').all() as { storage: string; n: number }[];
  return { local: rows.find((r) => r.storage === 'local')?.n ?? 0, object: rows.find((r) => r.storage === 's3')?.n ?? 0 };
}

export function allMediaFiles(): { file: string; location: StorageLocation }[] {
  return (db.prepare('SELECT * FROM media').all() as MediaRow[]).map((r) => ({ file: fileName(r), location: r.storage }));
}
