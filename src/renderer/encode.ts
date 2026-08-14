// In-browser video encode — assemble captured frames into an mp4 with WebCodecs +
// mediabunny, no ffmpeg. chrome-headless-shell (already our capture browser) has a
// hardware/software h264/hevc/vp9/av1 encoder; mediabunny is the zero-dep muxer. The
// browser side is render/encode-worker.ts (real, type-checked TS); spawnWorkerBrowser
// bundles + serves it and the captured frames over http, and the page fetches each frame
// and runs the WebCodecs pass via window.__encode.

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BufferSource, BufferTarget, EncodedPacketSink, EncodedVideoPacketSource, Input, MP4, Mp4OutputFormat, Output } from 'mediabunny';
import { must } from '../core/must';
import type { VideoCodec } from './types';
import { spawnWorkerBrowser } from './worker-browser';

export type { VideoCodec } from './types';

const ENCODE_WORKER = fileURLToPath(new URL('../../render/encode-worker.ts', import.meta.url));

export interface Encoder {
  /** Run the WebCodecs encode pass over the (now-complete) frames → mp4 at `output`. */
  encode: (output: string, fps: number, codec: VideoCodec, frameCount: number) => Promise<void>;
  close: () => Promise<void>;
}

/** Start the encoder browser, serving the slice's frames. encode() runs after capture, so
 *  the frames are already on disk — the route reads them directly. */
export async function startEncoder(opts: { exe: string; frameDir: string; frameFiles: string[] }): Promise<Encoder> {
  const worker = await spawnWorkerBrowser(opts.exe, ENCODE_WORKER, (pathname, res) => {
    const m = pathname.match(/^\/__frame\/(\d+)$/);
    if (!m) return false;
    const name = opts.frameFiles[Number(m[1])];
    if (!name) {
      res.statusCode = 404;
      res.end();
      return true;
    }
    res.setHeader('content-type', name.endsWith('.png') ? 'image/png' : 'image/jpeg');
    res.end(readFileSync(join(opts.frameDir, name)));
    return true;
  });
  return {
    encode: async (output, fps, codec, frameCount) => {
      const b64 = await worker.page.evaluate((n, f, c) => must(window.__encode)(n, f, c), frameCount, fps, codec);
      writeFileSync(output, Buffer.from(b64, 'base64'));
    },
    close: worker.close,
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
    copyFileSync(must(segmentPaths[0]), output);
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
      if (count === 0 && packet.type !== 'key')
        throw new Error(`concatSegments: ${p} does not start on a keyframe — would corrupt the join`);
      await source.add(packet.clone({ timestamp: packet.timestamp + offset }), firstAdd && decoderConfig ? { decoderConfig } : undefined);
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
