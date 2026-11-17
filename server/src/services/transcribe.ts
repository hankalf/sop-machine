import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import { newId } from '../util';
import { probe } from './ffmpeg';

/**
 * Speech-to-text for narrated recordings. Claude does not take audio, so this uses any
 * OpenAI-compatible transcription API: OpenAI (whisper-1), Groq (whisper-large-v3-turbo),
 * or a self-hosted Whisper server (e.g. speaches / faster-whisper-server) on Railway.
 */

const groqKey = process.env.GROQ_API_KEY?.trim();
const apiKey = process.env.TRANSCRIBE_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || groqKey || '';
const baseUrl = (process.env.TRANSCRIBE_BASE_URL?.trim() || (groqKey && !process.env.OPENAI_API_KEY ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1')).replace(/\/$/, '');
const model = process.env.TRANSCRIBE_MODEL?.trim() || (baseUrl.includes('groq.com') ? 'whisper-large-v3-turbo' : 'whisper-1');

/** Configured with a key, or with a base URL alone (self-hosted servers often need no key). */
export const transcriptionConfigured = Boolean(apiKey || process.env.TRANSCRIBE_BASE_URL);
export const transcriptionModel = transcriptionConfigured ? model : null;

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

function ffmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString();
      if (err.length > 50000) err = err.slice(-20000);
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg failed: ${err.slice(-300)}`))));
  });
}

/** Loudest point of the audio in dB, or null without audio. Screen recordings often carry a silent track. */
async function maxVolume(file: string): Promise<number | null> {
  const out = await ffmpeg(['-v', 'info', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-']);
  const m = /max_volume:\s*(-?[\d.]+) dB/.exec(out);
  return m ? Number(m[1]) : null;
}

const CHUNK_SECONDS = 600;

/** Returns timed narration, or null when the video has no meaningful audio. */
export async function transcribeVideo(file: string): Promise<TranscriptSegment[] | null> {
  if (!transcriptionConfigured) return null;
  const info = await probe(file);
  if (!info.hasAudio) return null;
  const peak = await maxVolume(file);
  if (peak === null || peak < -45) return null;

  const workDir = path.join(config.tmpDir, `audio-${newId()}`);
  await fsp.mkdir(workDir, { recursive: true });
  const segments: TranscriptSegment[] = [];
  try {
    for (let start = 0; start < Math.max(info.duration, 1); start += CHUNK_SECONDS) {
      const out = path.join(workDir, `chunk-${start}.mp3`);
      await ffmpeg(['-y', '-v', 'error', '-ss', String(start), '-t', String(CHUNK_SECONDS), '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', out]);
      const form = new FormData();
      form.append('file', new Blob([await fsp.readFile(out)], { type: 'audio/mpeg' }), 'audio.mp3');
      form.append('model', model);
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'segment');
      const res = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        body: form,
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });
      if (!res.ok) throw new Error(`Speech-to-text service returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as { text?: string; segments?: { start: number; end: number; text: string; no_speech_prob?: number }[] };
      if (data.segments?.length) {
        for (const seg of data.segments) {
          if ((seg.no_speech_prob ?? 0) > 0.6 || !seg.text.trim()) continue;
          segments.push({ start: seg.start + start, end: seg.end + start, text: seg.text.trim() });
        }
      } else if (data.text?.trim()) {
        segments.push({ start, end: Math.min(info.duration, start + CHUNK_SECONDS), text: data.text.trim() });
      }
    }
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
  return segments.length ? segments : null;
}

export function formatTranscript(segments: TranscriptSegment[]): string {
  const ts = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  return segments.map((s) => `[${ts(s.start)}–${ts(s.end)}] ${s.text}`).join('\n');
}
