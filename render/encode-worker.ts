// Browser-side video encoder. Bundled to an IIFE by esbuild (see src/renderer/encode.ts)
// and served to the encoder browser, which fetches captured frames over http and calls
// window.__encode() over its slice → WebCodecs + mediabunny → a base64 mp4 segment.

import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH } from 'mediabunny';
import type { VideoCodec } from '../src/renderer/types';
import { toBase64 } from './worker-util';

declare global {
  interface Window {
    __encode?: (n: number, fps: number, codec: VideoCodec) => Promise<string>;
    __ready?: boolean | undefined;
  }
}

const frame = async (i: number): Promise<ImageBitmap> => createImageBitmap(await (await fetch(`/__frame/${i}`)).blob());

async function encode(n: number, fps: number, codec: VideoCodec): Promise<string> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('encode: 2d canvas context unavailable');
  if (n <= 0) throw new Error('encode: no frames');
  let out: Output | undefined;
  let source: CanvasSource | undefined;
  let next = frame(0);
  for (let i = 0; i < n; i++) {
    const bmp = await next;
    if (i + 1 < n) next = frame(i + 1);
    if (i === 0) {
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      out = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
      source = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH });
      out.addVideoTrack(source, { frameRate: fps });
      await out.start();
    }
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    // Local timestamps (restart at 0 per slice) + a forced keyframe on frame 0, so each
    // segment is independently decodable and concatenates cleanly. swiftshader (software
    // encoder, per RENDER_ARGS) reliably honors forced keyframes.
    if (!source) throw new Error('encode: encoder was not started');
    await source.add(i / fps, 1 / fps, i === 0 ? { keyFrame: true } : undefined);
  }
  if (!out) throw new Error('encode: encoder was not started');
  await out.finalize();
  const buffer = (out.target as BufferTarget).buffer;
  if (!buffer) throw new Error('encode: muxer produced no output');
  return toBase64(buffer);
}

window.__encode = encode;
window.__ready = true;
