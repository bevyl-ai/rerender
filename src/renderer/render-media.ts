// renderMedia — match @remotion/renderer. Frame-step capture across N parallel
// browsers → h264 mp4, with the composition's <Audio>/<Video> mixed + muxed in.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { chromeExecutable } from '../../render/browser';
import type { CollectedAsset } from '../core/assets';
import { calculateAssetPositions, muxAudio } from './audio';
import { captureFrames, type CaptureOptions } from './capture';
import type { VideoConfig } from './types';

export interface RenderMediaOptions {
  composition: VideoConfig;
  serveUrl: string;
  outputLocation: string;
  inputProps?: Record<string, unknown>;
  codec?: 'h264';
  crf?: number;
  scale?: number;
  concurrency?: number;
  imageFormat?: 'png' | 'jpeg';
  jpegQuality?: number;
  muted?: boolean;
  pixelFormat?: string;
  frameRange?: number | [number, number];
  onProgress?: (p: { renderedFrames: number; progress: number }) => void;
}

export async function renderMedia(
  opts: RenderMediaOptions,
): Promise<{ buffer: null; slowestFrames: never[]; contentType: string }> {
  const { composition: c, serveUrl, outputLocation } = opts;
  const exe = await chromeExecutable();
  const crf = opts.crf ?? 18;
  const [from, to] = Array.isArray(opts.frameRange)
    ? opts.frameRange
    : typeof opts.frameRange === 'number'
      ? [opts.frameRange, opts.frameRange]
      : [0, c.durationInFrames - 1];
  const totalFrames = to - from + 1;
  const concurrency = opts.concurrency ?? Math.max(1, Math.floor(cpus().length / 2));
  const props = encodeURIComponent(JSON.stringify(opts.inputProps ?? {}));
  const stepUrl = `${serveUrl}/?step=1&comp=${encodeURIComponent(c.id)}&props=${props}`;
  const collectAudio = !opts.muted;
  const captureOpts: CaptureOptions = { scale: opts.scale, imageFormat: opts.imageFormat ?? 'png', jpegQuality: opts.jpegQuality, collectAudio };
  const ext = (opts.imageFormat ?? 'png') === 'jpeg' ? 'jpg' : 'png';

  const dir = mkdtempSync(join(tmpdir(), 'remover-render-'));
  try {
    const per = Math.ceil(totalFrames / concurrency);
    const ranges = Array.from({ length: concurrency }, (_, i) => [from + i * per, Math.min(from + (i + 1) * per, to + 1)] as const).filter(([a, b]) => a < b);
    const maps = await Promise.all(ranges.map(([a, b]) => captureFrames(exe, stepUrl, a, b, dir, c, captureOpts)));
    opts.onProgress?.({ renderedFrames: totalFrames, progress: 0.9 });

    const silent = join(dir, 'silent.mp4');
    execFileSync(
      'ffmpeg',
      ['-y', '-framerate', String(c.fps), '-start_number', String(from), '-i', join(dir, `f-%05d.${ext}`),
        '-c:v', 'libx264', '-pix_fmt', opts.pixelFormat ?? 'yuv420p', '-crf', String(crf), '-r', String(c.fps), '-movflags', '+faststart', silent],
      { stdio: 'ignore' },
    );

    if (collectAudio) {
      const frames = new Map<number, CollectedAsset[]>();
      for (const m of maps) for (const [f, a] of m) frames.set(f, a);
      const positions = calculateAssetPositions(frames);
      // download dev-server assets to local files — ffmpeg's http reader stalls on Vite streams.
      const local = new Map<string, string>();
      for (const p of positions) {
        if (local.has(p.src)) continue;
        const res = await fetch(p.src);
        const file = join(dir, `asset-${local.size}-${basename(new URL(p.src).pathname)}`);
        writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        local.set(p.src, file);
      }
      muxAudio(silent, outputLocation, positions.map((p) => ({ ...p, src: local.get(p.src)! })), c.fps);
    } else {
      copyFileSync(silent, outputLocation);
    }
    opts.onProgress?.({ renderedFrames: totalFrames, progress: 1 });
    return { buffer: null, slowestFrames: [], contentType: 'video/mp4' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
