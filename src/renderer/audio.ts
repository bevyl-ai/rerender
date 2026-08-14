// Audio assembly — turn per-frame collected assets into timeline positions, then mix
// + mux into the silent video, entirely in the browser (Web Audio + WebCodecs +
// mediabunny), no ffmpeg. Mirrors @remotion/renderer's calculateAssetPositions and the
// atrim/adelay/volume → amix pass: each span's source window is decoded via mediabunny
// (the same stack the preview plays through) and scheduled through a gain node carrying
// its per-frame volume envelope, all summed by an OfflineAudioContext; the mix is
// AAC-encoded and muxed alongside the (packet-copied) video.

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromeExecutable } from '../../render/browser';
import type { CollectedAsset } from '../core/assets';
import { must } from '../core/must';
import type { MuxPosition, VideoCodec } from './types';
import { spawnWorkerBrowser } from './worker-browser';

const MUX_WORKER = fileURLToPath(new URL('../../render/mux-worker.ts', import.meta.url));

export interface AssetPosition {
  type: 'audio' | 'video';
  src: string;
  id: string;
  startInVideo: number; // first composition frame the asset appears
  duration: number; // frame count
  trimLeft: number; // source-media frame at startInVideo
  volumes: number[]; // per-frame volume over the span (a fade envelope)
  playbackRate: number;
}

/** Walk per-frame assets, tracking each id's contiguous spans → AssetPositions. */
export function calculateAssetPositions(frames: Map<number, CollectedAsset[]>): AssetPosition[] {
  const byId = new Map<string, Map<number, CollectedAsset>>();
  for (const [f, list] of frames) {
    for (const a of list) {
      if (!byId.has(a.id)) byId.set(a.id, new Map());
      must(byId.get(a.id)).set(f, a);
    }
  }

  const positions: AssetPosition[] = [];
  for (const perFrame of byId.values()) {
    const sorted = [...perFrame.keys()].sort((x, y) => x - y);
    let runStart = must(sorted[0]);
    let prev = must(sorted[0]);
    const flush = (start: number, end: number): void => {
      const a = must(perFrame.get(start));
      positions.push({
        type: a.type,
        src: a.src,
        id: a.id,
        startInVideo: start,
        duration: end - start + 1,
        trimLeft: a.mediaFrame,
        volumes: Array.from({ length: end - start + 1 }, (_, k) => perFrame.get(start + k)?.volume ?? a.volume),
        playbackRate: a.playbackRate,
      });
    };
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== prev + 1) {
        flush(runStart, prev);
        runStart = must(sorted[i]);
      }
      prev = must(sorted[i]);
    }
    flush(runStart, prev);
  }
  return positions;
}

/** Mix the asset audio and mux it into the silent video → output, in the browser. */
export async function muxAudio(
  silentVideo: string,
  output: string,
  positions: AssetPosition[],
  fps: number,
  codec: VideoCodec,
  videoDurationSec: number,
  sampleRate = 44100,
): Promise<void> {
  if (positions.length === 0) {
    copyFileSync(silentVideo, output);
    return;
  }
  const durationSec = Math.max(videoDurationSec, ...positions.map((p) => (p.startInVideo + p.duration) / fps));
  // Spans that reuse a source file share one /__asset entry, so the worker parses and
  // decodes each file once no matter how many timeline cuts point at it.
  const uniqueSrcs: string[] = [];
  const srcIndexBySrc = new Map<string, number>();
  const muxPositions: MuxPosition[] = positions.map((p) => {
    let srcIndex = srcIndexBySrc.get(p.src);
    if (srcIndex === undefined) {
      srcIndex = uniqueSrcs.push(p.src) - 1;
      srcIndexBySrc.set(p.src, srcIndex);
    }
    return {
      srcIndex,
      startInVideo: p.startInVideo,
      duration: p.duration,
      trimLeft: p.trimLeft,
      volumes: p.volumes,
      playbackRate: p.playbackRate,
    };
  });

  const worker = await spawnWorkerBrowser(await chromeExecutable(), MUX_WORKER, (pathname, res) => {
    if (pathname === '/__silent') {
      res.setHeader('content-type', 'video/mp4');
      res.end(readFileSync(silentVideo));
      return true;
    }
    const m = pathname.match(/^\/__asset\/(\d+)$/);
    const src = m && uniqueSrcs[Number(m[1])];
    if (src) {
      res.end(readFileSync(src));
      return true;
    }
    return false;
  });
  try {
    const b64 = await worker.page.evaluate(
      (p, f, c, sr, d) => {
        const mux = window.__mux;
        if (!mux) throw new Error('expected a value');
        return mux(p, f, c, sr, d);
      },
      muxPositions,
      fps,
      codec,
      sampleRate,
      durationSec,
    );
    writeFileSync(output, Buffer.from(b64, 'base64'));
  } finally {
    await worker.close();
  }
}
