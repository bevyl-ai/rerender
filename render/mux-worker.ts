// Browser-side audio mix + mux. Bundled to an IIFE by esbuild (see src/renderer/audio.ts)
// and served to the mux browser. An OfflineAudioContext sums the asset audio (each
// scheduled at its timeline position through a gain node); mediabunny packet-copies the
// silent video and AAC-encodes the mix into one mp4. window.__mux() returns base64.
import {
  AudioBufferSource,
  BufferSource,
  BufferTarget,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  MP4,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';
import type { MuxPosition, VideoCodec } from '../src/renderer/types';
import { toBase64 } from './worker-util';

declare global {
  interface Window {
    __mux?: (positions: MuxPosition[], fps: number, codec: VideoCodec, sampleRate: number, durationSec: number) => Promise<string>;
    __ready?: boolean;
  }
}

async function mux(positions: MuxPosition[], fps: number, codec: VideoCodec, sampleRate: number, durationSec: number): Promise<string> {
  // 1. Sum every asset's audio into one buffer at its timeline position.
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(durationSec * sampleRate)), sampleRate);
  for (const p of positions) {
    const data = await (await fetch(`/__asset/${p.assetIndex}`)).arrayBuffer();
    let buffer: AudioBuffer;
    try {
      buffer = await ctx.decodeAudioData(data);
    } catch {
      continue; // asset with no decodable audio track (e.g. a silent video)
    }
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = p.volume;
    node.connect(gain).connect(ctx.destination);
    node.start(p.startInVideo / fps, p.trimLeft / fps, p.duration / fps);
  }
  const mixed = await ctx.startRendering();

  // 2. Copy the silent video's encoded packets + AAC-encode the mix into one mp4.
  const input = new Input({ formats: [MP4], source: new BufferSource(await (await fetch('/__silent')).arrayBuffer()) });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error('mux: silent video has no video track');
  const videoSink = new EncodedPacketSink(videoTrack);

  const out = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const videoSource = new EncodedVideoPacketSource(codec);
  out.addVideoTrack(videoSource, { frameRate: fps });
  const audioSource = new AudioBufferSource({ codec: 'aac', bitrate: 192_000 });
  out.addAudioTrack(audioSource);
  await out.start();

  const decoderConfig = await videoTrack.getDecoderConfig();
  let first = true;
  for await (const packet of videoSink.packets()) {
    await videoSource.add(packet, first ? { decoderConfig: decoderConfig ?? undefined } : undefined);
    first = false;
  }
  videoSource.close();
  await audioSource.add(mixed);
  audioSource.close();
  await out.finalize();
  return toBase64((out.target as BufferTarget).buffer!);
}

window.__mux = mux;
window.__ready = true;
