// renderMedia — match @remotion/renderer. Frame-step capture across N parallel
// browsers, encoded to mp4 in-browser (WebCodecs + mediabunny, no ffmpeg) overlapped
// with capture, then the composition's <Audio>/<Video> mixed + muxed in.
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { chromeExecutable } from '../../render/browser';
import type { CollectedAsset } from '../core/assets';
import { calculateAssetPositions, muxAudio } from './audio';
import { captureFrames, type CaptureOptions } from './capture';
import { concatSegments, startEncoder, type VideoCodec } from './encode';
import type { VideoConfig } from './types';

export interface RenderMediaOptions {
  composition: VideoConfig;
  serveUrl: string;
  outputLocation: string;
  inputProps?: Record<string, unknown>;
  codec?: 'h264';
  /** Video codec for the in-browser WebCodecs encoder (default avc/h264). */
  videoCodec?: VideoCodec;
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

export async function renderMedia(opts: RenderMediaOptions): Promise<{ buffer: null; slowestFrames: never[]; contentType: string }> {
  const { composition: c, serveUrl, outputLocation } = opts;
  const exe = await chromeExecutable();
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
  const captureOpts: CaptureOptions = {
    scale: opts.scale,
    imageFormat: opts.imageFormat ?? 'png',
    jpegQuality: opts.jpegQuality,
    collectAudio,
  };
  const ext = (opts.imageFormat ?? 'png') === 'jpeg' ? 'jpg' : 'png';

  const dir = mkdtempSync(join(tmpdir(), 'remover-render-'));
  try {
    const per = Math.ceil(totalFrames / concurrency);
    const ranges = Array.from({ length: concurrency }, (_, i) => [from + i * per, Math.min(from + (i + 1) * per, to + 1)] as const).filter(
      ([a, b]) => a < b,
    );
    const codec = opts.videoCodec ?? 'avc';
    const silent = join(dir, 'silent.mp4');
    const frameFiles = Array.from({ length: totalFrames }, (_, i) => `f-${String(from + i).padStart(5, '0')}.${ext}`);

    // No ffmpeg. Three in-process phases:
    // 1. Capture every slice in parallel. One browser per slice, NOT one browser with N
    //    pages — capture is CDP-command-heavy (setFrame + screenshot per frame) and a
    //    single browser shares one CDP connection, serializing those commands; N
    //    browsers give N parallel CDP connections and measured ~2x faster.
    const maps = await Promise.all(ranges.map(([a, b]) => captureFrames(exe, stepUrl, a, b, dir, c, captureOpts)));
    opts.onProgress?.({ renderedFrames: totalFrames, progress: 0.7 });

    // 2. Encode each slice in parallel — one WebCodecs+mediabunny encoder per slice over
    //    its own frames (local indices 0..n-1, forced keyframe at 0) → segment-i.mp4.
    //    Fans out like capture, so encode is ~total/concurrency, not one serial pass.
    const segmentPaths = ranges.map((_, i) => join(dir, `segment-${i}.mp4`));
    const encoders = await Promise.all(
      ranges.map(([a, b]) => startEncoder({ exe, frameDir: dir, frameFiles: frameFiles.slice(a - from, b - from) })),
    );
    await Promise.all(encoders.map((enc, i) => enc.encode(segmentPaths[i]!, c.fps, codec, ranges[i]![1] - ranges[i]![0])));
    await Promise.all(encoders.map((enc) => enc.close()));
    opts.onProgress?.({ renderedFrames: totalFrames, progress: 0.85 });

    // 3. Concat segments → silent.mp4 (Node, mediabunny packet-copy, no re-encode, ~10ms).
    await concatSegments(segmentPaths, codec, c.fps, silent);
    opts.onProgress?.({ renderedFrames: totalFrames, progress: 0.9 });

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
      await muxAudio(
        silent,
        outputLocation,
        positions.map((p) => ({ ...p, src: local.get(p.src)! })),
        c.fps,
        codec,
        c.durationInFrames / c.fps,
      );
    } else {
      copyFileSync(silent, outputLocation);
    }
    opts.onProgress?.({ renderedFrames: totalFrames, progress: 1 });
    return { buffer: null, slowestFrames: [], contentType: 'video/mp4' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
