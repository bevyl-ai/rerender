// Audio assembly — turn per-frame collected assets into timeline positions, then mix
// + mux into the silent video, entirely in the browser (Web Audio + WebCodecs +
// mediabunny), no ffmpeg. Mirrors @remotion/renderer's calculateAssetPositions and the
// atrim/adelay/volume → amix pass: each asset becomes a buffer source scheduled at
// start(when=startInVideo/fps, offset=trimLeft/fps, duration), through a gain node, all
// summed by an OfflineAudioContext; the mix is AAC-encoded and muxed alongside the
// (packet-copied) video. POC: scalar volume, playbackRate 1.
import { createServer, type Server } from 'node:http';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CollectedAsset } from '../core/assets';
import { chromeExecutable } from '../../render/browser';
import { launchBrowser } from './capture';
import type { MuxPosition, VideoCodec } from './types';
import { bundleWorkerHtml } from './worker-bundle';

const MUX_WORKER = fileURLToPath(new URL('../../render/mux-worker.ts', import.meta.url));

export interface AssetPosition {
  type: 'audio' | 'video';
  src: string;
  id: string;
  startInVideo: number; // first composition frame the asset appears
  duration: number; // frame count
  trimLeft: number; // source-media frame at startInVideo
  volume: number;
  playbackRate: number;
}

/** Walk per-frame assets, tracking each id's contiguous spans → AssetPositions. */
export function calculateAssetPositions(frames: Map<number, CollectedAsset[]>): AssetPosition[] {
  const byId = new Map<string, Map<number, CollectedAsset>>();
  for (const [f, list] of frames) {
    for (const a of list) {
      if (!byId.has(a.id)) byId.set(a.id, new Map());
      byId.get(a.id)!.set(f, a);
    }
  }

  const positions: AssetPosition[] = [];
  for (const perFrame of byId.values()) {
    const sorted = [...perFrame.keys()].sort((x, y) => x - y);
    let runStart = sorted[0]!;
    let prev = sorted[0]!;
    const flush = (start: number, end: number): void => {
      const a = perFrame.get(start)!;
      positions.push({
        type: a.type,
        src: a.src,
        id: a.id,
        startInVideo: start,
        duration: end - start + 1,
        trimLeft: a.mediaFrame,
        volume: a.volume,
        playbackRate: a.playbackRate,
      });
    };
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== prev + 1) {
        flush(runStart, prev);
        runStart = sorted[i]!;
      }
      prev = sorted[i]!;
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
  const html = await bundleWorkerHtml(MUX_WORKER);
  const durationSec = Math.max(videoDurationSec, ...positions.map((p) => (p.startInVideo + p.duration) / fps));
  const muxPositions: MuxPosition[] = positions.map((p, i) => ({
    assetIndex: i,
    startInVideo: p.startInVideo,
    duration: p.duration,
    trimLeft: p.trimLeft,
    volume: p.volume,
  }));

  const server: Server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0]!;
    if (url === '/') {
      res.setHeader('content-type', 'text/html');
      res.end(html);
      return;
    }
    if (url === '/__silent') {
      res.setHeader('content-type', 'video/mp4');
      res.end(readFileSync(silentVideo));
      return;
    }
    const m = url.match(/^\/__asset\/(\d+)$/);
    if (m && positions[Number(m[1])]) {
      res.end(readFileSync(positions[Number(m[1])]!.src));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const browser = await launchBrowser(await chromeExecutable());
  try {
    const page = (await browser.pages())[0] ?? (await browser.newPage());
    page.on('pageerror', (e) => console.error('[muxAudio]', String(e).slice(0, 200)));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, { timeout: 30_000 });
    const b64 = await page.evaluate((p, f, c, sr, d) => window.__mux!(p, f, c, sr, d), muxPositions, fps, codec, sampleRate, durationSec);
    writeFileSync(output, Buffer.from(b64, 'base64'));
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
