// In-browser video encode — assemble captured frames into an mp4 with WebCodecs +
// mediabunny, no ffmpeg. chrome-headless-shell (already our capture browser) has a
// hardware/software h264/hevc/vp9/av1 encoder; mediabunny is the zero-dep muxer.
//
// The encoder page is a mediabunny IIFE pre-bundled once with esbuild and served from
// a plain http server (no Vite — so it starts instantly and doesn't disturb the
// concurrent capture Vite/browsers). The page FETCHES frames over http and pipelines
// (decode N+1 while encoding N). Two-phase: startEncoder() loads the page (overlaps
// capture), encode() runs the WebCodecs pass once frames are on disk.
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BufferSource, BufferTarget, EncodedPacketSink, EncodedVideoPacketSource, Input, MP4, Mp4OutputFormat, Output } from 'mediabunny';
import puppeteer from 'puppeteer-core';
import { RENDER_ARGS } from './capture';

const REMOVER_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export type VideoCodec = 'avc' | 'hevc' | 'vp9' | 'av1';

declare global {
  interface Window {
    __encode?: (n: number, fps: number, codec: string) => Promise<string>;
  }
}

// Source of the encoder page; esbuild inlines mediabunny into an IIFE (mediabunny
// resolves from REMOVER_ROOT/node_modules). Sets window.__encode + window.__ready.
const ENCODER_SRC = `
import { Output, Mp4OutputFormat, BufferTarget, CanvasSource, QUALITY_HIGH } from 'mediabunny';
const frame = async (i) => createImageBitmap(await (await fetch('/__frame/' + i)).blob());
window.__encode = async (n, fps, codec) => {
  let canvas, ctx, out, src;
  let next = frame(0);
  for (let i = 0; i < n; i++) {
    const bmp = await next;
    if (i + 1 < n) next = frame(i + 1);
    if (i === 0) {
      canvas = document.createElement('canvas'); canvas.width = bmp.width; canvas.height = bmp.height;
      ctx = canvas.getContext('2d', { alpha: false });
      out = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
      src = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH });
      out.addVideoTrack(src, { frameRate: fps });
      await out.start();
    }
    ctx.drawImage(bmp, 0, 0); bmp.close();
    // Local timestamps (restart at 0 per slice) + a forced keyframe on frame 0, so each
    // segment is independently decodable and concatenates cleanly. swiftshader (software
    // encoder, per RENDER_ARGS) reliably honors forced keyframes.
    await src.add(i / fps, 1 / fps, i === 0 ? { keyFrame: true } : undefined);
  }
  await out.finalize();
  const u = new Uint8Array(out.target.buffer);
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, i + CH));
  return btoa(s);
};
window.__ready = true;
`;

let bundledEncoder: string | null = null;
async function encoderHtml(): Promise<string> {
  if (!bundledEncoder) {
    const r = await build({ stdin: { contents: ENCODER_SRC, resolveDir: REMOVER_ROOT, loader: 'js' }, bundle: true, format: 'iife', write: false, logLevel: 'error' });
    bundledEncoder = r.outputFiles![0]!.text;
  }
  return `<!doctype html><html><body><script>${bundledEncoder}</script></body></html>`;
}

export interface Encoder {
  /** Run the WebCodecs encode pass over the (now-complete) frames → mp4 at `output`. */
  encode: (output: string, fps: number, codec: VideoCodec, frameCount: number) => Promise<void>;
  close: () => Promise<void>;
}

/** Start the encoder server + browser and load the page (cheap — overlaps capture). */
export async function startEncoder(opts: { exe: string; frameDir: string; frameFiles: string[] }): Promise<Encoder> {
  const html = await encoderHtml();
  const server: Server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0]!;
    if (url === '/') { res.setHeader('content-type', 'text/html'); res.end(html); return; }
    const m = url.match(/^\/__frame\/(\d+)$/);
    if (m) {
      const name = opts.frameFiles[Number(m[1])];
      if (!name) { res.statusCode = 404; res.end(); return; }
      const file = join(opts.frameDir, name);
      // long-poll until the frame lands (capture writes it atomically) — usually
      // instant since encode() runs after capture, but robust if it overlaps.
      const started = Date.now();
      const send = (): void => {
        if (existsSync(file)) {
          res.setHeader('content-type', name.endsWith('.png') ? 'image/png' : 'image/jpeg');
          res.end(readFileSync(file));
        } else if (Date.now() - started > 120_000) {
          res.statusCode = 504;
          res.end();
        } else {
          setTimeout(send, 8);
        }
      };
      send();
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const browser = await puppeteer.launch({ executablePath: opts.exe, headless: 'shell', args: RENDER_ARGS });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[encode]', String(e).slice(0, 200)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 30_000 });
  return {
    encode: async (output, fps, codec, frameCount) => {
      const b64 = await page.evaluate((n, f, c) => window.__encode!(n, f, c), frameCount, fps, codec);
      writeFileSync(output, Buffer.from(b64, 'base64'));
    },
    close: async () => {
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Concatenate N independently-encoded h264 mp4 segments into one — in Node, no
 *  browser and no ffmpeg. Pure demux→mux: read each segment's encoded packets and
 *  append them to one output track, shifting timestamps by the cumulative duration of
 *  prior segments. Each segment must start on a keyframe (the per-slice encoder forces
 *  one) — a delta frame at a join would silently corrupt playback, so we hard-fail. */
export async function concatSegments(segmentPaths: string[], codec: VideoCodec, fps: number, output: string): Promise<void> {
  if (segmentPaths.length === 0) throw new Error('concatSegments: no segments');
  if (segmentPaths.length === 1) {
    copyFileSync(segmentPaths[0]!, output);
    return;
  }
  const source = new EncodedVideoPacketSource(codec);
  const target = new BufferTarget();
  const out = new Output({ format: new Mp4OutputFormat(), target });
  out.addVideoTrack(source, { frameRate: fps });
  await out.start();
  let offset = 0;
  let firstAdd = true;
  for (const p of segmentPaths) {
    const input = new Input({ formats: [MP4], source: new BufferSource(readFileSync(p)) });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error(`concatSegments: no video track in ${p}`);
    const sink = new EncodedPacketSink(track);
    const decoderConfig = await track.getDecoderConfig();
    let segEnd = 0;
    let count = 0;
    for await (const packet of sink.packets()) {
      if (count === 0 && packet.type !== 'key') throw new Error(`concatSegments: ${p} does not start on a keyframe — would corrupt the join`);
      await source.add(packet.clone({ timestamp: packet.timestamp + offset }), firstAdd ? { decoderConfig: decoderConfig ?? undefined } : undefined);
      firstAdd = false;
      segEnd = Math.max(segEnd, packet.timestamp + packet.duration);
      count += 1;
    }
    offset += segEnd;
  }
  source.close();
  await out.finalize();
  if (!target.buffer) throw new Error('concatSegments: muxer produced no output');
  writeFileSync(output, Buffer.from(target.buffer));
}

/** One-shot convenience: start, encode, close. */
export async function encodeFramesToMp4(opts: {
  exe: string;
  frameDir: string;
  frameFiles: string[];
  fps: number;
  codec?: VideoCodec;
  output: string;
}): Promise<void> {
  const enc = await startEncoder(opts);
  try {
    await enc.encode(opts.output, opts.fps, opts.codec ?? 'avc', opts.frameFiles.length);
  } finally {
    await enc.close();
  }
}
