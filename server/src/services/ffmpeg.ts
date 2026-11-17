import { spawn } from 'node:child_process';

export interface ProbeResult {
  duration: number;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  formatName: string;
  hasAudio: boolean;
  rotation: number;
}

function run(cmd: string, args: string[], opts: { collectStdout?: boolean } = {}): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (d: Buffer) => opts.collectStdout !== false && out.push(d));
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString();
      if (err.length > 20000) err = err.slice(-10000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err });
      else reject(new Error(`${cmd} exited with code ${code}: ${err.slice(-600)}`));
    });
  });
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file,
  ]);
  const info = JSON.parse(stdout.toString()) as {
    format?: { duration?: string; format_name?: string };
    streams?: { codec_type: string; codec_name?: string; width?: number; height?: number; duration?: string; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[];
  };
  const video = info.streams?.find((s) => s.codec_type === 'video');
  const rotationRaw = Number(video?.tags?.rotate ?? video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0);
  const rotation = Math.abs(rotationRaw) % 180 === 90 ? 90 : 0;
  let width = video?.width ?? null;
  let height = video?.height ?? null;
  if (rotation && width && height) [width, height] = [height, width];
  return {
    duration: Number(info.format?.duration ?? video?.duration ?? 0) || 0,
    width,
    height,
    videoCodec: video?.codec_name ?? null,
    formatName: info.format?.format_name ?? '',
    hasAudio: !!info.streams?.some((s) => s.codec_type === 'audio'),
    rotation,
  };
}

/** Grab a single frame as JPEG (accurate seek). */
export async function extractFrame(file: string, seconds: number, outPath: string, maxWidth?: number) {
  const args = ['-y', '-v', 'error', '-ss', Math.max(0, seconds).toFixed(3), '-i', file, '-frames:v', '1'];
  if (maxWidth) args.push('-vf', `scale='min(${maxWidth},iw)':-2`);
  args.push('-q:v', '2', outPath);
  await run('ffmpeg', args);
}

/** Re-encode to H.264/AAC MP4 (max 1080p) so every browser can play it. */
export async function transcodeToMp4(input: string, output: string) {
  await run('ffmpeg', [
    '-y', '-v', 'error', '-i', input,
    '-vf', "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))',format=yuv420p",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    output,
  ]);
}

/**
 * Decode the video at a low frame rate into small grayscale frames held in memory.
 * Used to find the moments where the screen changes.
 */
export async function sampleGrayFrames(file: string, fps: number, width = 160): Promise<{ frames: Buffer[]; width: number; height: number }> {
  const p = await probe(file);
  const srcW = p.width ?? 1280;
  const srcH = p.height ?? 720;
  const height = Math.max(2, Math.round((width * srcH) / srcW / 2) * 2);
  const { stdout } = await run('ffmpeg', [
    '-v', 'error', '-i', file,
    '-vf', `fps=${fps.toFixed(4)},scale=${width}:${height},format=gray`,
    '-f', 'rawvideo', 'pipe:1',
  ]);
  const frameSize = width * height;
  const frames: Buffer[] = [];
  for (let off = 0; off + frameSize <= stdout.length; off += frameSize) frames.push(stdout.subarray(off, off + frameSize));
  return { frames, width, height };
}

export const BROWSER_SAFE_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1']);
