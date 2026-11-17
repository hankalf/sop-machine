import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { CalloutType, GenerationJob, JobStatus, JobType, SopContent, Step, User } from '../../../shared/types';
import { emptyContent } from '../../../shared/defaults';
import { config } from '../config';
import { db } from '../db';
import { newId, notFound, nowIso } from '../util';
import { type FrameInput, type GeneratedSop, type GenerationContext, sopFromExistingDocument, sopFromFrames, sopFromText, translateSop } from './ai';
import { extractDocument } from './documents';
import { extractFrame, probe, sampleGrayFrames } from './ffmpeg';
import { getMedia, migrateToObjectStorage, originalLocalPath, storeBuffer } from './media';
import { getSettings } from './settings';
import { formatTranscript, transcribeVideo, transcriptionConfigured } from './transcribe';
import { createSop, getSop } from './sops';
import { alignTranslation, designFor, saveTranslation, sourceContent, sourceStrings } from './translations';
import { languageInfo } from '../../../shared/defaults';
import { buildBinder, type BinderInput } from '../render/binder';
import { listCategories } from './templates';

// ---------------------------------------------------------------------------
// Job records
// ---------------------------------------------------------------------------

interface JobRow {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  message: string;
  title: string;
  input: string;
  result_sop_id: string | null;
  result_file: string | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecordingJobInput {
  videoMediaId: string;
  categoryId: string | null;
  ctx: GenerationContext;
}

export interface ImportJobInput {
  filePath: string;
  fileName: string;
  mime: string;
  /** A category id, "auto" to let AI pick, or null. */
  categoryId: string | null;
  templateId: string | null;
  keepNumbers: boolean;
}

export interface NotesJobInput {
  text: string;
  pdfPath: string | null;
  categoryId: string | null;
  ctx: GenerationContext;
}

const toJob = (r: JobRow): GenerationJob => ({
  id: r.id,
  type: r.type,
  status: r.status,
  progress: r.progress,
  message: r.message,
  title: r.title,
  resultSopId: r.result_sop_id,
  downloadUrl: r.result_file && r.status === 'done' ? `/api/jobs/${r.id}/download` : null,
  error: r.error,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function getJob(id: string): GenerationJob {
  const r = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
  if (!r) throw notFound('Job not found');
  return toJob(r);
}

export function listJobs(types: JobType[], limit = 20): GenerationJob[] {
  const marks = types.map(() => '?').join(', ');
  return (db.prepare(`SELECT * FROM jobs WHERE type IN (${marks}) ORDER BY created_at DESC LIMIT ?`).all(...types, limit) as JobRow[]).map(toJob);
}

export function jobFile(id: string): { file: string; title: string } | null {
  const r = db.prepare("SELECT result_file, title FROM jobs WHERE id = ? AND status = 'done'").get(id) as { result_file: string | null; title: string } | undefined;
  return r?.result_file && fs.existsSync(r.result_file) ? { file: r.result_file, title: r.title } : null;
}

function update(id: string, fields: Partial<Pick<JobRow, 'status' | 'progress' | 'message' | 'result_sop_id' | 'result_file' | 'error'>>) {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  db.prepare(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(
    ...keys.map((k) => fields[k] ?? null),
    nowIso(),
    id,
  );
}

const progress = (id: string, pct: number, message: string) => update(id, { status: 'running', progress: Math.round(pct), message });

// ---------------------------------------------------------------------------
// Queues: AI work runs one at a time; exports and storage moves have their own lane
// so a binder never waits behind a long recording.
// ---------------------------------------------------------------------------

type Lane = 'ai' | 'files';
const laneOf = (type: JobType): Lane => (type === 'binder' || type === 'storage' ? 'files' : 'ai');
const lanes: Record<Lane, { queue: string[]; running: boolean }> = { ai: { queue: [], running: false }, files: { queue: [], running: false } };
const users = new Map<string, User>();

function enqueue(jobId: string, type: JobType, user: User) {
  const lane = lanes[laneOf(type)];
  lane.queue.push(jobId);
  users.set(jobId, user);
  void pump(lane);
}

async function pump(lane: { queue: string[]; running: boolean }) {
  if (lane.running) return;
  lane.running = true;
  try {
    while (lane.queue.length) {
      const id = lane.queue.shift()!;
      const user = users.get(id)!;
      users.delete(id);
      try {
        await runJob(id, user);
      } catch (err) {
        console.error('job failed', id, err);
        update(id, { status: 'error', error: (err as Error).message.slice(0, 1000), message: 'Failed' });
      }
    }
  } finally {
    lane.running = false;
  }
}

export function createJob(type: JobType, title: string, input: unknown, user: User): GenerationJob {
  const id = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO jobs (id, type, status, progress, message, title, input, created_by, created_at, updated_at)
     VALUES (?, ?, 'queued', 0, 'Waiting to start', ?, ?, ?, ?, ?)`,
  ).run(id, type, title, JSON.stringify(input), user.id, now, now);
  enqueue(id, type, user);
  return getJob(id);
}

/** Jobs cannot survive a restart (they run in this process). Also clears leftover temp files. */
export function failInterruptedJobs() {
  for (const entry of fs.readdirSync(config.tmpDir)) fs.rmSync(path.join(config.tmpDir, entry), { recursive: true, force: true });
  db.prepare(
    `UPDATE jobs SET status = 'error', error = 'Interrupted by a server restart. Please run it again.', message = 'Failed', updated_at = ?
     WHERE status IN ('queued', 'running')`,
  ).run(nowIso());
}

async function runJob(id: string, user: User) {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow;
  const input = JSON.parse(row.input);
  switch (row.type) {
    case 'recording':
      return runRecording(id, input as RecordingJobInput, user);
    case 'import':
      return runImport(id, input as ImportJobInput, user);
    case 'notes':
      return runNotes(id, input as NotesJobInput, user);
    case 'translate':
      return runTranslate(id, input as TranslateJobInput, user);
    case 'binder':
      return runBinder(id, input as BinderInput);
    case 'storage':
      return runStorageMove(id);
  }
}

// ---------------------------------------------------------------------------
// Frame selection
// ---------------------------------------------------------------------------

/** Fraction of pixels that changed noticeably between two small grayscale frames. */
function changedFraction(a: Buffer, b: Buffer): number {
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 24) changed++;
  return changed / a.length;
}

/**
 * Pick the timestamps worth showing to the model.
 * Screen recordings: the "settled" screen right before each significant change (that is where the
 * user is about to click), plus the final screen. Camera videos: evenly spaced, least-blurry frames.
 */
export async function selectFrameTimes(file: string, duration: number, maxFrames: number, type: 'screen' | 'physical'): Promise<number[]> {
  if (duration < 1) return [0];
  const fps = Math.min(2, Math.max(0.2, 900 / duration));
  const { frames } = await sampleGrayFrames(file, fps);
  if (frames.length < 2) return [0];
  const diffs = frames.map((f, i) => (i === 0 ? 0 : changedFraction(frames[i - 1], f)));
  const timeOf = (i: number) => Math.min(duration - 0.05, i / fps);

  if (type === 'physical') {
    const count = Math.min(maxFrames, Math.max(6, Math.round(duration / 4)));
    const win = frames.length / count;
    const picks: number[] = [];
    for (let k = 0; k < count; k++) {
      const start = Math.floor(k * win);
      const end = Math.max(start + 1, Math.floor((k + 1) * win));
      let best = start;
      for (let i = start; i < end && i < frames.length; i++) {
        const motion = diffs[i] + (diffs[i + 1] ?? 0);
        const bestMotion = diffs[best] + (diffs[best + 1] ?? 0);
        if (motion < bestMotion) best = i;
      }
      picks.push(best);
    }
    return [...new Set(picks)].map(timeOf);
  }

  // Screen recording
  const THRESHOLD = 0.006;
  const minStable = Math.max(1, Math.round(0.5 * fps));
  const candidates: { index: number; importance: number }[] = [];
  let segStart = 0;
  for (let i = 1; i <= frames.length; i++) {
    const boundary = i === frames.length || diffs[i] > THRESHOLD;
    if (!boundary) continue;
    const segLen = i - segStart;
    if (segLen >= minStable || i === frames.length || segStart === 0) {
      const importance = i === frames.length ? 1 : diffs[i];
      candidates.push({ index: i - 1, importance });
    }
    segStart = i;
  }
  // Drop near-duplicates (e.g. a dialog opened and closed again).
  const unique: typeof candidates = [];
  for (const c of candidates) {
    const prev = unique[unique.length - 1];
    if (prev && changedFraction(frames[prev.index], frames[c.index]) < THRESHOLD) {
      prev.index = c.index;
      prev.importance = Math.max(prev.importance, c.importance);
    } else unique.push({ ...c });
  }
  let chosen = unique;
  if (chosen.length > maxFrames) {
    const first = chosen[0];
    const last = chosen[chosen.length - 1];
    const middle = chosen
      .slice(1, -1)
      .sort((a, b) => b.importance - a.importance)
      .slice(0, maxFrames - 2);
    chosen = [first, ...middle, last].sort((a, b) => a.index - b.index);
  }
  let indexes = chosen.map((c) => c.index);
  // Nearly static recordings (e.g. mostly typing): add evenly spaced frames so the model still sees the flow.
  const want = Math.min(maxFrames, 6);
  if (indexes.length < 3 && duration > 10) {
    for (let k = 0; k < want; k++) indexes.push(Math.round(((k + 0.5) * (frames.length - 1)) / want));
    indexes = [...new Set(indexes)].sort((a, b) => a - b);
  }
  return indexes.map(timeOf);
}

// ---------------------------------------------------------------------------
// Building the SOP from the model output
// ---------------------------------------------------------------------------

const AI_FRAME_MAX = 1568;

async function drawHighlight(image: Buffer, box: { x: number; y: number; width: number; height: number }, scale: number) {
  const meta = await sharp(image).metadata();
  const w = meta.width ?? 1;
  const h = meta.height ?? 1;
  const stroke = Math.max(3, Math.round(w / 320));
  const pad = stroke * 2;
  const x = Math.max(0, Math.round(box.x * scale) - pad);
  const y = Math.max(0, Math.round(box.y * scale) - pad);
  const bw = Math.min(w - x, Math.round(box.width * scale) + pad * 2);
  const bh = Math.min(h - y, Math.round(box.height * scale) + pad * 2);
  if (bw < 6 || bh < 6) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="${x + stroke / 2}" y="${y + stroke / 2}" width="${bw - stroke}" height="${bh - stroke}" rx="${stroke * 2}" fill="none" stroke="#ef4444" stroke-width="${stroke}"/></svg>`;
  return sharp(image).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 90 }).toBuffer();
}

function toContent(gen: GeneratedSop): SopContent {
  return {
    ...emptyContent(),
    purpose: gen.purpose,
    scope: gen.scope,
    responsibilities: gen.responsibilities,
    safety: gen.safety,
    tools: gen.tools,
    notes: gen.notes,
    steps: gen.steps.map(
      (s): Step => ({
        id: newId(),
        kind: s.kind,
        title: s.title,
        body: s.kind === 'section' ? '' : s.instructions,
        callout: { type: (s.kind === 'section' ? 'none' : s.callout_type) as CalloutType, text: s.kind === 'section' ? '' : s.callout_text },
        media: [],
      }),
    ),
  };
}

async function runRecording(jobId: string, input: RecordingJobInput, user: User) {
  const settings = getSettings();
  const video = getMedia(input.videoMediaId);
  const file = await originalLocalPath(video.id);
  progress(jobId, 5, 'Reading the recording');
  const info = await probe(file);

  progress(jobId, 10, 'Finding the key moments');
  const times = await selectFrameTimes(file, info.duration, settings.ai.maxFrames, input.ctx.recordingType);

  const workDir = path.join(config.tmpDir, `job-${jobId}`);
  await fsp.mkdir(workDir, { recursive: true });
  try {
    const full: { file: string; time: number }[] = [];
    for (let i = 0; i < times.length; i++) {
      progress(jobId, 12 + (i / times.length) * 18, `Capturing frame ${i + 1} of ${times.length}`);
      const out = path.join(workDir, `f${String(i).padStart(3, '0')}.jpg`);
      await extractFrame(file, times[i], out, 2560);
      full.push({ file: out, time: times[i] });
    }

    const frames: (FrameInput & { full: Buffer; scale: number })[] = [];
    for (const f of full) {
      const buf = await fsp.readFile(f.file);
      const meta = await sharp(buf).metadata();
      const small = await sharp(buf).resize({ width: AI_FRAME_MAX, height: AI_FRAME_MAX, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true });
      const mm = Math.floor(f.time / 60);
      const ss = Math.floor(f.time % 60);
      frames.push({
        data: small.data,
        width: small.info.width,
        height: small.info.height,
        label: `${mm}:${String(ss).padStart(2, '0')}`,
        full: buf,
        scale: (meta.width ?? small.info.width) / small.info.width,
      });
    }

    let narrationNote = '';
    if (settings.ai.useNarration && transcriptionConfigured) {
      progress(jobId, 31, 'Transcribing the narration');
      try {
        const segments = await transcribeVideo(file);
        if (segments) {
          input.ctx.narration = formatTranscript(segments);
          narrationNote = ' and the narration';
        }
      } catch (err) {
        console.warn('[transcribe] failed; continuing without narration', err);
        narrationNote = ' (narration could not be transcribed)';
      }
    }

    progress(jobId, 35, `Writing the SOP with AI from ${frames.length} frames${narrationNote} (this can take a few minutes)`);
    const gen = await sopFromFrames(settings, frames, input.ctx);

    progress(jobId, 85, 'Adding screenshots to the steps');
    const content = toContent(gen);
    const used = new Set<number>();
    for (let i = 0; i < gen.steps.length; i++) {
      const s = gen.steps[i];
      const frameIndex = s.images[0] ?? -1;
      if (s.kind !== 'step' || frameIndex < 0 || frameIndex >= frames.length || used.has(frameIndex)) continue;
      used.add(frameIndex);
      const f = frames[frameIndex];
      const clean = await storeBuffer(f.full, `frame-${f.label.replace(':', 'm')}s.jpg`, 'image/jpeg', user.id);
      let mediaId = clean.id;
      if (settings.ai.autoHighlight && s.highlight) {
        const marked = await drawHighlight(f.full, s.highlight, f.scale).catch(() => null);
        if (marked) mediaId = (await storeBuffer(marked, `frame-${f.label.replace(':', 'm')}s-highlight.jpg`, 'image/jpeg', user.id, clean.id)).id;
      }
      content.steps[i].media.push({ mediaId, caption: '' });
    }
    content.attachments.push({ mediaId: video.id, caption: input.ctx.recordingType === 'screen' ? 'Full screen recording' : 'Full video' });

    const sop = createSop(
      { title: gen.title || input.ctx.processName || 'Untitled SOP', categoryId: input.categoryId, content, source: 'ai-recording', tags: gen.tags },
      user,
    );
    update(jobId, {
      status: 'done',
      progress: 100,
      message: `Created ${content.steps.filter((s) => s.kind === 'step').length} steps${input.ctx.narration ? ' using the narration' : ''}`,
      result_sop_id: sop.id,
    });
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

async function runNotes(jobId: string, input: NotesJobInput, user: User) {
  const settings = getSettings();
  progress(jobId, 15, 'Reading your material');
  const pdf = input.pdfPath ? await fsp.readFile(input.pdfPath) : undefined;
  progress(jobId, 30, 'Writing the SOP with AI (this can take a minute or two)');
  try {
    const gen = await sopFromText(settings, { text: input.text, pdf, ctx: input.ctx });
    const content = toContent(gen);
    const sop = createSop(
      { title: gen.title || input.ctx.processName || 'Untitled SOP', categoryId: input.categoryId, content, source: 'ai-notes', tags: gen.tags },
      user,
    );
    update(jobId, { status: 'done', progress: 100, message: `Created ${content.steps.filter((s) => s.kind === 'step').length} steps`, result_sop_id: sop.id });
  } finally {
    if (input.pdfPath) await fsp.rm(input.pdfPath, { force: true });
  }
}

async function runImport(jobId: string, input: ImportJobInput, user: User) {
  const settings = getSettings();
  const workDir = path.join(config.tmpDir, `job-${jobId}`);
  await fsp.mkdir(workDir, { recursive: true });
  try {
    progress(jobId, 8, 'Reading the document');
    const doc = await extractDocument(input.filePath, input.fileName, input.mime, workDir);
    const categories = listCategories();
    progress(
      jobId,
      25,
      `Converting to the standard format with AI${doc.images.length ? ` (${doc.images.length} images found)` : ''}. This can take a few minutes.`,
    );
    const gen = await sopFromExistingDocument(settings, {
      fileName: input.fileName,
      pdf: doc.pdf ?? undefined,
      text: doc.text || undefined,
      images: doc.images.map((im) => ({ data: im.preview, width: im.width, height: im.height, label: im.label })),
      categories,
    });

    progress(jobId, 85, 'Placing images on the steps');
    const content = toContent(gen);
    const used = new Set<number>();
    for (let i = 0; i < gen.steps.length; i++) {
      for (const idx of gen.steps[i].images) {
        if (gen.steps[i].kind !== 'step' || idx < 0 || idx >= doc.images.length || used.has(idx)) continue;
        used.add(idx);
        const im = doc.images[idx];
        const media = await storeBuffer(im.data, `${path.parse(input.fileName).name}-image-${idx + 1}.${im.mime === 'image/png' ? 'png' : 'jpg'}`, im.mime, user.id);
        content.steps[i].media.push({ mediaId: media.id, caption: '' });
      }
    }
    const o = gen.original;
    const origin = [
      `Imported from **${input.fileName}**`,
      o?.number && `original number ${o.number}`,
      o?.version && `revision ${o.version}`,
      o?.effectiveDate && `effective ${o.effectiveDate}`,
    ]
      .filter(Boolean)
      .join(', ');
    content.notes = [content.notes.trim(), `_${origin}._`].filter(Boolean).join('\n\n');

    const categoryId =
      input.categoryId === 'auto'
        ? (categories.find((c) => c.code.toUpperCase() === gen.categoryCode.trim().toUpperCase())?.id ?? null)
        : input.categoryId;
    const sop = createSop(
      {
        title: gen.title || path.parse(input.fileName).name,
        categoryId,
        templateId: input.templateId,
        content,
        source: 'ai-import',
        tags: gen.tags,
        owner: o?.owner || undefined,
        approver: o?.approver || undefined,
        number: input.keepNumbers ? o?.number : undefined,
        version: input.keepNumbers ? o?.version : undefined,
      },
      user,
    );
    const placed = used.size ? `, ${used.size} image${used.size === 1 ? '' : 's'}` : '';
    update(jobId, { status: 'done', progress: 100, message: `Converted to ${sop.number}: ${content.steps.filter((s) => s.kind === 'step').length} steps${placed}`, result_sop_id: sop.id });
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
    await fsp.rm(input.filePath, { force: true });
  }
}

export interface TranslateJobInput {
  sopId: string;
  language: string;
}

async function runTranslate(jobId: string, input: TranslateJobInput, user: User) {
  const settings = getSettings();
  const sop = getSop(input.sopId);
  const language = languageInfo(input.language);
  progress(jobId, 20, `Translating into ${language.name}`);
  const source = { content: sourceContent(sop), strings: sourceStrings(designFor(sop)) };
  const result = await translateSop(settings, source, language);
  // The SOP may have been edited while translating; save against the text that was translated.
  const latest = getSop(input.sopId);
  if (JSON.stringify(sourceContent(latest)) !== JSON.stringify(source.content)) {
    throw new Error('The SOP changed while it was being translated. Run the translation again.');
  }
  saveTranslation(latest, language.code, alignTranslation(source.content, result.content), { ...source.strings, ...result.strings }, user.id);
  update(jobId, { status: 'done', progress: 100, message: `Translated into ${language.name}`, result_sop_id: sop.id });
}

async function runBinder(jobId: string, input: BinderInput) {
  progress(jobId, 2, 'Collecting SOPs');
  const out = await buildBinder(jobId, input, (pct, message) => progress(jobId, pct, message));
  update(jobId, { status: 'done', progress: 100, message: `${out.count} SOP${out.count === 1 ? '' : 's'} · ${out.pages} pages`, result_file: out.file });
}

async function runStorageMove(jobId: string) {
  progress(jobId, 1, 'Moving files to object storage');
  const res = await migrateToObjectStorage((done, total) => progress(jobId, Math.max(1, (done / Math.max(total, 1)) * 100), `Moved ${done} of ${total} files`));
  update(jobId, { status: 'done', progress: 100, message: `Moved ${res.moved} files${res.failed ? `, ${res.failed} failed (see logs)` : ''}` });
}
