import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { Request, Response } from 'express';
import { config } from '../config';

/**
 * Where uploaded originals live: the Railway volume (default) or any S3-compatible bucket
 * (Railway Buckets, AWS S3, Cloudflare R2, Backblaze B2, MinIO…).
 * Derived files (thumbnails, previews, posters) are always cached on local disk.
 */

const env = (...names: string[]) => names.map((n) => process.env[n]).find((v) => v && v.trim())?.trim();

const s3Config = {
  bucket: env('S3_BUCKET', 'BUCKET', 'AWS_S3_BUCKET_NAME'),
  endpoint: env('S3_ENDPOINT', 'ENDPOINT', 'AWS_ENDPOINT_URL_S3', 'AWS_ENDPOINT_URL'),
  region: env('S3_REGION', 'REGION', 'AWS_REGION', 'AWS_DEFAULT_REGION') ?? 'auto',
  accessKeyId: env('S3_ACCESS_KEY_ID', 'ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID'),
  secretAccessKey: env('S3_SECRET_ACCESS_KEY', 'SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY'),
  forcePathStyle: env('S3_FORCE_PATH_STYLE') === 'true',
};

export const objectStorageEnabled = Boolean(s3Config.bucket && s3Config.accessKeyId && s3Config.secretAccessKey);
export const bucketName = objectStorageEnabled ? s3Config.bucket! : null;

let client: S3Client | null = null;
function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: s3Config.region,
      endpoint: s3Config.endpoint,
      forcePathStyle: s3Config.forcePathStyle,
      // Many S3-compatible services reject the newer default checksum trailers.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: { accessKeyId: s3Config.accessKeyId!, secretAccessKey: s3Config.secretAccessKey! },
    });
  }
  return client;
}

const objectKey = (file: string) => `media/${file}`;
const localPath = (file: string) => path.join(config.uploadsDir, file);
const cacheDir = path.join(config.tmpDir, 'object-cache');

export type StorageLocation = 'local' | 's3';

/** Store a finished original. The local file is moved (local) or uploaded and removed (s3). */
export async function saveOriginal(file: string, source: string, contentType: string): Promise<StorageLocation> {
  if (!objectStorageEnabled) {
    if (path.resolve(source) !== path.resolve(localPath(file))) await move(source, localPath(file));
    return 'local';
  }
  await new Upload({
    client: s3(),
    params: { Bucket: s3Config.bucket!, Key: objectKey(file), Body: fs.createReadStream(source), ContentType: contentType },
    queueSize: 4,
    partSize: 16 * 1024 * 1024,
  }).done();
  await fsp.rm(source, { force: true });
  return 's3';
}

/** A local path to the original, downloading it from the bucket into a cache when needed. */
export async function localOriginal(file: string, location: StorageLocation): Promise<string> {
  if (location === 'local') return localPath(file);
  const cached = path.join(cacheDir, file);
  if (fs.existsSync(cached)) {
    const now = new Date();
    await fsp.utimes(cached, now, now).catch(() => {});
    return cached;
  }
  await fsp.mkdir(cacheDir, { recursive: true });
  const out = await s3().send(new GetObjectCommand({ Bucket: s3Config.bucket!, Key: objectKey(file) }));
  const tmp = `${cached}.${process.pid}.part`;
  await pipeline(out.Body as Readable, fs.createWriteStream(tmp));
  await fsp.rename(tmp, cached);
  void pruneCache();
  return cached;
}

/** Keep the download cache under ~2 GB, oldest first. */
async function pruneCache() {
  const entries = await fsp.readdir(cacheDir).catch(() => [] as string[]);
  const stats = await Promise.all(entries.map(async (f) => ({ f, s: await fsp.stat(path.join(cacheDir, f)).catch(() => null) })));
  const files = stats.filter((x) => x.s?.isFile()).sort((a, b) => a.s!.mtimeMs - b.s!.mtimeMs);
  let total = files.reduce((n, x) => n + x.s!.size, 0);
  for (const x of files) {
    if (total < 2 * 1024 ** 3) break;
    await fsp.rm(path.join(cacheDir, x.f), { force: true });
    total -= x.s!.size;
  }
}

/** Send an original to the browser, supporting Range requests so videos can seek. */
export async function sendOriginal(req: Request, res: Response, file: string, location: StorageLocation, contentType: string) {
  if (location === 'local') {
    res.type(contentType);
    res.sendFile(localPath(file));
    return;
  }
  const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
  const out = await s3().send(new GetObjectCommand({ Bucket: s3Config.bucket!, Key: objectKey(file), Range: range }));
  res.status(range && out.ContentRange ? 206 : 200);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Accept-Ranges', 'bytes');
  if (out.ContentLength !== undefined) res.setHeader('Content-Length', String(out.ContentLength));
  if (out.ContentRange) res.setHeader('Content-Range', out.ContentRange);
  await pipeline(out.Body as Readable, res);
}

export async function deleteOriginal(file: string, location: StorageLocation) {
  if (location === 'local') await fsp.rm(localPath(file), { force: true });
  else await s3().send(new DeleteObjectCommand({ Bucket: s3Config.bucket!, Key: objectKey(file) })).catch(() => {});
  await fsp.rm(path.join(cacheDir, file), { force: true });
}

/** Stream for backups. */
export async function readOriginal(file: string, location: StorageLocation): Promise<Readable> {
  if (location === 'local') return fs.createReadStream(localPath(file));
  const out = await s3().send(new GetObjectCommand({ Bucket: s3Config.bucket!, Key: objectKey(file) }));
  return out.Body as Readable;
}

export async function checkBucket(): Promise<{ ok: boolean; detail: string }> {
  if (!objectStorageEnabled) return { ok: true, detail: 'Using the Railway volume' };
  try {
    await s3().send(new HeadBucketCommand({ Bucket: s3Config.bucket! }));
    return { ok: true, detail: `Bucket ${s3Config.bucket}` };
  } catch (err) {
    return { ok: false, detail: `Bucket ${s3Config.bucket}: ${(err as Error).message}` };
  }
}

async function move(from: string, to: string) {
  try {
    await fsp.rename(from, to);
  } catch {
    await fsp.copyFile(from, to);
    await fsp.rm(from, { force: true });
  }
}
